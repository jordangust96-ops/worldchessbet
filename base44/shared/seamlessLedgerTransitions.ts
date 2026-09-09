import { postLedgerLegs, applyBalanceHold } from './ledger.ts';

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

export async function postSeamlessSettlement(base44, transaction, rawAmount, providerRef, sourceEvent) {
  const amount = money(rawAmount);
  const groupId = transaction.type === 'deposit'
    ? `seamless:deposit:settle:${transaction.id}`
    : `seamless:withdrawal:settle:${transaction.id}`;

  if (transaction.type === 'deposit') {
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: transaction.id,
      actor: 'system',
      triggerEvent: 'deposit',
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
    const legs = [
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
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: transaction.id,
      actor: 'system',
      triggerEvent: 'refund',
      externalRefType: 'provider_refund',
      externalRefId: providerRef,
      legs,
    });

    if (shortfall > 0) {
      const user = await base44.asServiceRole.entities.User.get(transaction.user_id);
      await base44.asServiceRole.entities.User.update(transaction.user_id, {
        withdrawal_hold: true,
        ach_return_balance_due: money(Number(user.ach_return_balance_due || 0) + shortfall),
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
  return { shortfall };
}

export async function releaseDepositAvailability(base44, transaction) {
  if (transaction.type !== 'deposit' || transaction.deposit_hold_status !== 'held') return false;
  await applyBalanceHold(base44, {
    userId: transaction.user_id,
    amount: Number(transaction.amount),
    direction: 'release',
    actor: 'system',
    triggerEvent: 'deposit_availability_release',
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
  });
  return true;
}
