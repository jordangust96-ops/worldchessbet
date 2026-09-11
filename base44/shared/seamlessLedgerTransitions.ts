import { postLedgerLegs, applyBalanceHold } from './ledger.ts';
import { requireVerifiedDeposit, postDepositFeePassThrough, flagDepositReview, depositProviderReference } from './depositReconciliation.ts';
import { isFeeDeposit } from './depositReconciliationPure.js';
import { claimWebhookEvent, finishWebhookEvent } from './seamlessAtomicStore.ts';

const DEFAULT_HOLD_BUSINESS_DAYS = 5;

function money(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('invalid_money_amount');
  return Math.round(parsed * 100) / 100;
}

function holdBusinessDays() {
  const configured = Number(Deno.env.get('ACH_DEPOSIT_HOLD_BUSINESS_DAYS') || DEFAULT_HOLD_BUSINESS_DAYS);
  if (!Number.isInteger(configured) || configured < 1 || configured > 10) return DEFAULT_HOLD_BUSINESS_DAYS;
  return configured;
}

export function depositAvailabilityAt(transaction) {
  const started = new Date(transaction.created_date || transaction.processed_at || Date.now());
  if (!Number.isFinite(started.getTime())) throw new Error('invalid_deposit_timestamp');
  let remaining = holdBusinessDays();
  const cursor = new Date(started);
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return cursor.toISOString();
}

export async function refundWithdrawalFee(base44, withdrawal, providerRef, reason = 'withdrawal_failed') {
  const feeKey = withdrawal.idempotency_key ? `${withdrawal.idempotency_key}:fee` : '';
  if (!feeKey) return null;
  const fee = (await base44.asServiceRole.entities.WalletTransaction.filter(
    { user_id: withdrawal.user_id, type: 'withdrawal_fee', idempotency_key: feeKey },
    '-created_date',
    1
  ))[0];
  if (!fee || fee.status !== 'completed' || !(Number(fee.amount) > 0)) return null;

  const refundKey = `${withdrawal.idempotency_key}:fee-refund`;
  let refund = (await base44.asServiceRole.entities.WalletTransaction.filter(
    { user_id: withdrawal.user_id, type: 'withdrawal_fee_refund', idempotency_key: refundKey },
    '-created_date',
    1
  ))[0];
  if (!refund) {
    refund = await base44.asServiceRole.entities.WalletTransaction.create({
      launch_epoch: 2,
      user_id: withdrawal.user_id,
      type: 'withdrawal_fee_refund',
      amount: Number(fee.amount),
      description: 'Small-withdrawal fee returned because the bank transfer did not complete',
      status: 'pending',
      integration_status: 'pending',
      currency: 'USD',
      direction: 'credit',
      source_event: 'withdrawal_fee_refund',
      initiating_actor: 'system',
      initiating_actor_id: '',
      idempotency_key: refundKey,
      correlation_id: withdrawal.id,
      schema_version: 2,
    });
  }

  await postLedgerLegs(base44, {
    groupId: `seamless:withdrawal:fee-refund:${withdrawal.id}`,
    walletTransactionId: refund.id,
    actor: 'system',
    triggerEvent: 'withdrawal_fee_refund',
    externalRefType: 'provider_payout',
    externalRefId: providerRef || withdrawal.id,
    legs: [
      { ledgerAccount: 'platform_revenue', debit: Number(fee.amount), credit: 0, transactionType: 'refund' },
      { ledgerAccount: 'user_account', userId: withdrawal.user_id, debit: 0, credit: Number(fee.amount), transactionType: 'refund' },
    ],
  });

  await base44.asServiceRole.entities.WalletTransaction.update(fee.id, {
    description: `Small-withdrawal fee — refunded because ${reason.replace(/_/g, ' ')}`,
  });
  return refund;
}

// Recover durable postings before interpreting a newer provider status. A crash
// after journal commit must not make a later bank return look like an unfunded
// failure or strand a successfully credited deposit.
export async function recoverFeeDepositState(base44, transaction) {
  if (!isFeeDeposit(transaction) || ['failed', 'reversed'].includes(transaction.status)) return transaction;
  const groups = [
    'seamless:deposit:settle:' + transaction.id,
    'deposit_availability_release:' + transaction.id + ':release',
  ];
  let settled = false, released = false;
  for (let index = 0; index < groups.length; index++) {
    const batch = (await base44.asServiceRole.entities.LedgerJournalBatch.filter(
      { ledger_group_id: groups[index] }, '-created_at', 1
    ))[0];
    if (!batch) continue;
    const entries = JSON.parse(batch.legs_json);
    await postLedgerLegs(base44, {
      groupId: batch.ledger_group_id, matchId: batch.match_id || '', gameId: batch.game_id || '',
      walletTransactionId: batch.wallet_transaction_id || '', actor: batch.initiating_actor,
      actorId: batch.initiating_actor_id || '', triggerEvent: batch.trigger_event,
      externalRefType: batch.external_reference_type, externalRefId: batch.external_reference_id,
      updateTransactions: false,
      legs: entries.map(entry => ({
        ledgerAccount: entry.ledger_account, userId: entry.user_id || '',
        walletTransactionId: entry.wallet_transaction_id || '',
        debit: entry.debit_amount, credit: entry.credit_amount,
        availableDelta: entry.available_delta, heldDelta: entry.held_delta,
        totalWageredDelta: entry.total_wagered_delta, totalWonDelta: entry.total_won_delta,
        totalDepositedDelta: entry.total_deposited_delta, totalWithdrawnDelta: entry.total_withdrawn_delta,
        transactionType: entry.transaction_type,
      })),
    });
    if (index === 0) settled = true;
    else released = true;
  }
  if (!settled) return transaction;
  const recovered = { ...transaction, status: 'completed', integration_status: 'settled',
    deposit_hold_status: released ? 'released' : 'held',
    deposit_release_at: transaction.deposit_release_at || depositAvailabilityAt(transaction),
    ledger_group_id: released ? groups[1] : groups[0],
  };
  const returned = (await base44.asServiceRole.entities.LedgerJournalBatch.filter({
    ledger_group_id: 'seamless:deposit:reverse:' + transaction.id,
  }, '-created_at', 1))[0];
  if (returned) {
    await reverseSeamlessSettlement(base44, recovered, Number(transaction.amount),
      returned.external_reference_id, 'deposit_return_recovered_from_journal');
  } else {
    await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, {
      status: recovered.status, integration_status: recovered.integration_status,
      deposit_hold_status: recovered.deposit_hold_status, deposit_release_at: recovered.deposit_release_at,
      ledger_group_id: recovered.ledger_group_id,
    });
  }
  return base44.asServiceRole.entities.WalletTransaction.get(transaction.id);
}

export async function postSeamlessSettlement(base44, transaction, rawAmount, providerRef, sourceEvent) {
  const amount = money(rawAmount);
  const groupId = transaction.type === 'deposit'
    ? `seamless:deposit:settle:${transaction.id}`
    : `seamless:withdrawal:settle:${transaction.id}`;

  if (transaction.type === 'deposit') {
    if (amount !== Number(transaction.amount)) throw new Error('deposit_principal_mismatch');
    const verified = await requireVerifiedDeposit(base44, transaction, providerRef);
    await postDepositFeePassThrough(base44, transaction, verified);
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: transaction.id,
      actor: 'system',
      triggerEvent: 'deposit',
      updateTransactions: !isFeeDeposit(transaction),
      externalRefType: 'provider_payment',
      externalRefId: providerRef,
      legs: [
        { ledgerAccount: 'settlement', debit: amount, credit: 0, transactionType: 'deposit' },
        {
          ledgerAccount: 'user_account',
          userId: transaction.user_id,
          debit: 0,
          credit: 0,
          creditHeld: amount,
          transactionType: 'deposit',
          totalDepositedDelta: amount,
        },
      ],
    });
    const releaseAt = transaction.deposit_release_at || depositAvailabilityAt(transaction);
    await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, {
      status: 'completed',
      integration_status: 'settled',
      ledger_group_id: groupId,
      processed_at: transaction.processed_at || new Date().toISOString(),
      source_event: sourceEvent,
      deposit_hold_status: 'held',
      deposit_release_at: releaseAt,
      provider_last_status: 'Processed',
      provider_last_checked_at: new Date().toISOString(),
      description: `Deposit received and clearing — available after ${new Date(releaseAt).toLocaleDateString('en-US', { timeZone: 'UTC' })} following a final bank-status check`,
    });
  } else {
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: transaction.id,
      actor: 'system',
      triggerEvent: 'withdrawal',
      externalRefType: 'provider_payout',
      externalRefId: providerRef,
      legs: [
        { ledgerAccount: 'withdrawal_reserve', debit: amount, credit: 0, transactionType: 'withdrawal' },
        { ledgerAccount: 'settlement', debit: 0, credit: amount, transactionType: 'withdrawal' },
        {
          ledgerAccount: 'user_account',
          userId: transaction.user_id,
          debit: 0,
          credit: 0,
          heldDelta: -amount,
          transactionType: 'withdrawal',
          totalWithdrawnDelta: amount,
        },
      ],
    });
    await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, {
      status: 'completed',
      integration_status: 'settled',
      ledger_group_id: groupId,
      processed_at: transaction.processed_at || new Date().toISOString(),
      source_event: sourceEvent,
      provider_last_status: 'Processed',
      provider_last_checked_at: new Date().toISOString(),
    });
  }
}

export async function releaseSeamlessWithdrawal(base44, transaction, rawAmount, providerRef, failureReason, sourceEvent) {
  const amount = money(rawAmount);
  const groupId = `seamless:withdrawal:release:${transaction.id}`;
  await postLedgerLegs(base44, {
    groupId,
    walletTransactionId: transaction.id,
    actor: 'system',
    triggerEvent: 'withdrawal_reservation_release',
    externalRefType: 'provider_payout',
    externalRefId: providerRef,
    legs: [
      { ledgerAccount: 'withdrawal_reserve', debit: amount, credit: 0, transactionType: 'reversal' },
      {
        ledgerAccount: 'user_account',
        userId: transaction.user_id,
        debit: 0,
        credit: amount,
        heldDelta: -amount,
        transactionType: 'reversal',
      },
    ],
  });
  await refundWithdrawalFee(base44, transaction, providerRef, 'withdrawal_failed');
  await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, {
    status: 'failed',
    integration_status: 'failed',
    ledger_group_id: groupId,
    processed_at: new Date().toISOString(),
    source_event: sourceEvent,
    provider_last_checked_at: new Date().toISOString(),
    description: `Withdrawal failed — ${failureReason}`,
  });
}

// Debt is derived from immutable return receivables, so replaying an interrupted
// return cannot increment the customer's amount due twice.
async function recordedReturnDebt(base44, userId) {
  let total = 0;
  for (let skip = 0; ; skip += 500) {
    const transactions = await base44.asServiceRole.entities.WalletTransaction.filter(
      { user_id: userId, type: 'deposit' }, 'created_date', 500, skip
    );
    if (transactions.length) {
      for (let rowSkip = 0; ; rowSkip += 500) {
        const entries = await base44.asServiceRole.entities.LedgerEntry.filter({
          launch_epoch: 2, ledger_account: 'ach_return_receivable',
          wallet_transaction_id: { $in: transactions.map(tx => tx.id) },
        }, 'created_date', 500, rowSkip);
        total += entries.reduce((sum, entry) => sum + Number(entry.debit_amount || 0) - Number(entry.credit_amount || 0), 0);
        if (entries.length < 500) break;
      }
    }
    if (transactions.length < 500) break;
  }
  return money(total);
}

export async function reverseSeamlessSettlement(base44, transaction, rawAmount, providerRef, sourceEvent) {
  const amount = money(rawAmount);
  const groupId = transaction.type === 'deposit'
    ? `seamless:deposit:reverse:${transaction.id}`
    : `seamless:withdrawal:reverse:${transaction.id}`;

  let shortfall = 0;
  if (transaction.type === 'deposit') {
    const wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: transaction.user_id }))[0];
    const heldRecovery = transaction.deposit_hold_status === 'held'
      ? Math.min(amount, money(wallet?.held_balance))
      : 0;
    const availableRecovery = Math.min(
      amount - heldRecovery,
      money(wallet?.available_balance)
    );
    const recovered = money(heldRecovery + availableRecovery);
    shortfall = money(amount - recovered);
    let legs = [
      {
        ledgerAccount: 'user_account',
        userId: transaction.user_id,
        debit: recovered,
        credit: 0,
        availableDelta: -availableRecovery,
        heldDelta: -heldRecovery,
        transactionType: 'refund',
        totalDepositedDelta: -amount,
      },
    ];
    if (shortfall > 0) {
      legs.push({
        ledgerAccount: 'ach_return_receivable',
        debit: shortfall,
        credit: 0,
        transactionType: 'reversal',
      });
    }
    legs.push({
      ledgerAccount: 'settlement',
      debit: 0,
      credit: amount,
      transactionType: 'refund',
    });
    if (isFeeDeposit(transaction)) {
      const saved = (await base44.asServiceRole.entities.LedgerJournalBatch.filter(
        { ledger_group_id: groupId }, '-created_at', 1
      ))[0];
      if (saved) {
        const entries = JSON.parse(saved.legs_json);
        shortfall = money(entries.find(entry => entry.ledger_account === 'ach_return_receivable')?.debit_amount);
        legs = entries.map(entry => ({
          ledgerAccount: entry.ledger_account, userId: entry.user_id || undefined,
          debit: entry.debit_amount, credit: entry.credit_amount,
          availableDelta: entry.available_delta, heldDelta: entry.held_delta,
          totalDepositedDelta: entry.total_deposited_delta, transactionType: entry.transaction_type,
        }));
      }
    }
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: transaction.id,
      actor: 'system',
      triggerEvent: 'refund',
      updateTransactions: !isFeeDeposit(transaction),
      externalRefType: 'provider_refund',
      externalRefId: providerRef,
      legs,
    });

    if (shortfall > 0) {
      const user = await base44.asServiceRole.entities.User.get(transaction.user_id);
      await base44.asServiceRole.entities.User.update(transaction.user_id, {
        withdrawal_hold: true,
        ach_return_balance_due: isFeeDeposit(transaction)
          ? await recordedReturnDebt(base44, transaction.user_id)
          : money(Number(user.ach_return_balance_due || 0) + shortfall),
      });
    }
    await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, {
      deposit_hold_status: 'returned',
      description: shortfall > 0
        ? `Deposit returned after release — $${shortfall.toFixed(2)} requires account review`
        : 'Deposit returned by the bank — credited funds were removed safely',
    });
  } else {
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: transaction.id,
      actor: 'system',
      triggerEvent: 'reversal',
      externalRefType: 'provider_reversal',
      externalRefId: providerRef,
      legs: [
        { ledgerAccount: 'settlement', debit: amount, credit: 0, transactionType: 'reversal' },
        { ledgerAccount: 'user_account', userId: transaction.user_id, debit: 0, credit: amount, transactionType: 'reversal', totalWithdrawnDelta: -amount },
      ],
    });
    await refundWithdrawalFee(base44, transaction, providerRef, 'withdrawal_reversed');
  }

  await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, {
    status: 'reversed',
    integration_status: 'reversed',
    ledger_group_id: groupId,
    processed_at: new Date().toISOString(),
    source_event: sourceEvent,
    provider_last_checked_at: new Date().toISOString(),
  });
  if (isFeeDeposit(transaction)) {
    await flagDepositReview(base44, transaction, 'returned_deposit_fee_evidence_required', 'return');
  }
  return { shortfall };
}

// Use the same per-provider transaction lease as webhook and status recovery so
// a return cannot race a clearing release. A failed verification stays retryable.
export async function releaseDepositAvailability(base44, transaction) {
  if (!isFeeDeposit(transaction)) return releaseDepositAvailabilityUnlocked(base44, transaction);
  const ref = await depositProviderReference(base44, transaction);
  const key = 'deposit-verified-release:' + transaction.id;
  const owner = crypto.randomUUID();
  const claim = await claimWebhookEvent(key, ref, owner);
  if (claim?.claim === 'completed') return false;
  if (claim?.claim !== 'owned') throw new Error('deposit_transition_in_progress');
  try {
    const released = await releaseDepositAvailabilityUnlocked(base44, transaction);
    await finishWebhookEvent(key, ref, owner, released ? 'completed' : 'retryable');
    return released;
  } catch (error) {
    try { await finishWebhookEvent(key, ref, owner, 'retryable', 'deposit_release_verification_failed'); } catch { /* lease expires */ }
    throw error;
  }
}

async function releaseDepositAvailabilityUnlocked(base44, transaction) {
  if (transaction.type !== 'deposit' || transaction.deposit_hold_status !== 'held') return false;
  if (isFeeDeposit(transaction)) {
    const fresh = await base44.asServiceRole.entities.WalletTransaction.get(transaction.id);
    if (fresh.status !== 'completed' || fresh.deposit_hold_status !== 'held') return false;
    if (!(Date.parse(fresh.deposit_release_at || '') <= Date.now())) return false;
    await requireVerifiedDeposit(base44, fresh, await depositProviderReference(base44, fresh));
  }
  await applyBalanceHold(base44, {
    userId: transaction.user_id,
    amount: Number(transaction.amount),
    direction: 'release',
    actor: 'system',
    triggerEvent: 'deposit_availability_release',
    updateTransactions: !isFeeDeposit(transaction),
    walletTransactionId: transaction.id,
  });
  await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, {
    status: 'completed',
    integration_status: 'settled',
    deposit_hold_status: 'released',
    provider_last_status: 'Processed',
    provider_last_checked_at: new Date().toISOString(),
    source_event: 'deposit_availability_release',
    description: 'Deposit cleared and available to play or withdraw',
    deposit_available_email_status: 'pending',
    deposit_available_email_attempts: 0,
    deposit_available_email_next_attempt_at: new Date().toISOString(),
    deposit_available_email_last_error: '',
  });
  return true;
}
