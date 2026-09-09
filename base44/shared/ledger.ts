import { recordIntegrationEvent } from './integrationEvents.ts';
import { acquireLedgerLock, releaseLedgerLock } from './seamlessAtomicStore.ts';

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function userAvailableDelta(leg) {
  return Number.isFinite(leg.availableDelta)
    ? Number(leg.availableDelta)
    : number(leg.credit) - number(leg.debit);
}

function userHeldDelta(leg) {
  return number(leg.heldDelta) + number(leg.creditHeld);
}

async function ensureWallet(base44, userId) {
  const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: userId });
  if (wallets[0]) return wallets[0];
  return base44.asServiceRole.entities.Wallet.create({
    user_id: userId,
    balance: 0,
    available_balance: 0,
    held_balance: 0,
    total_balance: 0,
    total_wagered: 0,
    total_won: 0,
    total_deposited: 0,
    total_withdrawn: 0,
  });
}

async function ensureSystemAccount(base44, accountName) {
  const accounts = await base44.asServiceRole.entities.SystemLedgerAccount.filter({ account_name: accountName });
  if (accounts[0]) return accounts[0];
  return base44.asServiceRole.entities.SystemLedgerAccount.create({
    account_name: accountName,
    balance: 0,
  });
}

// The immutable journal is authoritative. Wallet and system-account balances
// are materialized projections which can always be rebuilt from it after an
// interrupted write.
export async function rebuildLedgerBalances(base44, { userIds = [], systemAccounts = [] } = {}) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    const [wallet, entries] = await Promise.all([
      ensureWallet(base44, userId),
      base44.asServiceRole.entities.LedgerEntry.filter(
        { launch_epoch: 2, user_id: userId },
        'created_date',
        5000
      ),
    ]);
    const totals = entries.reduce((sum, entry) => {
      const legacyAvailable = number(entry.credit_amount) - number(entry.debit_amount);
      sum.available += entry.available_delta == null ? legacyAvailable : number(entry.available_delta);
      sum.held += number(entry.held_delta);
      sum.wagered += number(entry.total_wagered_delta);
      sum.won += number(entry.total_won_delta);
      sum.deposited += number(entry.total_deposited_delta);
      sum.withdrawn += number(entry.total_withdrawn_delta);
      return sum;
    }, { available: 0, held: 0, wagered: 0, won: 0, deposited: 0, withdrawn: 0 });

    const available = Math.round(totals.available * 100) / 100;
    const held = Math.round(totals.held * 100) / 100;
    const total = Math.round((available + held) * 100) / 100;
    if (available < -0.001 || held < -0.001 || total < -0.001) {
      throw new Error(`Ledger journal would materialize a negative user balance for ${userId}`);
    }
    await base44.asServiceRole.entities.Wallet.update(wallet.id, {
      available_balance: available,
      held_balance: held,
      total_balance: total,
      balance: available,
      total_wagered: Math.round(totals.wagered * 100) / 100,
      total_won: Math.round(totals.won * 100) / 100,
      total_deposited: Math.round(totals.deposited * 100) / 100,
      total_withdrawn: Math.round(totals.withdrawn * 100) / 100,
    });
  }

  for (const accountName of [...new Set(systemAccounts.filter(Boolean))]) {
    const [account, entries] = await Promise.all([
      ensureSystemAccount(base44, accountName),
      base44.asServiceRole.entities.LedgerEntry.filter(
        { launch_epoch: 2, ledger_account: accountName },
        'created_date',
        5000
      ),
    ]);
    const balance = Math.round(entries.reduce(
      (sum, entry) => sum - number(entry.debit_amount) + number(entry.credit_amount),
      0
    ) * 100) / 100;
    if (['contest_clearing', 'suspense', 'platform_revenue'].includes(accountName) && balance < -0.001) {
      throw new Error(`Ledger journal would overdraw protected account: ${accountName}`);
    }
    await base44.asServiceRole.entities.SystemLedgerAccount.update(account.id, { balance });
  }
}

// Shared Internal Ledger posting helper. The write order is journal-first:
// 1) a global Redis lease serializes all money postings,
// 2) every immutable leg is durably written with a stable group + leg index,
// 3) every affected Wallet/SystemLedgerAccount is rebuilt from the journal.
//
// If a worker disappears after step 2, retrying the deterministic group (or
// the scheduled materialization sweep) repairs every projection without
// moving money twice.
export async function postLedgerLegs(base44, { groupId, matchId, gameId, walletTransactionId, actor, actorId, triggerEvent, externalRefType, externalRefId, legs }) {
  const correlationId = matchId || walletTransactionId || groupId;
  if (!groupId || !Array.isArray(legs) || legs.length < 2) {
    throw new Error('Invalid ledger posting request');
  }
  for (const leg of legs) {
    for (const amount of [
      leg.debit || 0,
      leg.credit || 0,
      leg.heldDelta || 0,
      leg.creditHeld || 0,
      leg.availableDelta || 0,
    ]) {
      if (!Number.isFinite(amount)) throw new Error('Ledger amount must be finite');
    }
    if (number(leg.debit) < 0 || number(leg.credit) < 0 || number(leg.creditHeld) < 0) {
      throw new Error('Ledger debit and credit amounts cannot be negative');
    }
  }
  const totalDebit = legs.reduce((sum, leg) => sum + number(leg.debit), 0);
  const totalCredit = legs.reduce((sum, leg) => sum + number(leg.credit) + number(leg.creditHeld), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    throw new Error(`Unbalanced ledger legs: debit=${totalDebit} credit=${totalCredit}`);
  }

  const lockOwner = crypto.randomUUID();
  if (!await acquireLedgerLock(lockOwner)) throw new Error('ledger_posting_in_progress');

  try {
    const affectedUserIds = [...new Set(legs.map((leg) => leg.userId).filter(Boolean))];
    const affectedSystemAccounts = [...new Set(
      legs.filter((leg) => leg.ledgerAccount !== 'user_account').map((leg) => leg.ledgerAccount)
    )];

    let existing = await base44.asServiceRole.entities.LedgerEntry.filter(
      { ledger_group_id: groupId },
      'ledger_leg_index',
      100
    );
    const existingIndexes = new Set(existing.map((entry) => number(entry.ledger_leg_index)));
    if (existing.length > legs.length || existingIndexes.size !== existing.length) {
      throw new Error('ledger_group_integrity_error');
    }

    if (existing.length === 0) {
      const walletByUser = new Map();
      for (const userId of affectedUserIds) walletByUser.set(userId, await ensureWallet(base44, userId));
      const systemByName = new Map();
      for (const accountName of affectedSystemAccounts) {
        systemByName.set(accountName, await ensureSystemAccount(base44, accountName));
      }

      const projectedUsers = new Map([...walletByUser].map(([id, wallet]) => [id, {
        available: number(wallet.available_balance),
        held: number(wallet.held_balance),
      }]));
      const projectedSystems = new Map([...systemByName].map(([name, account]) => [name, number(account.balance)]));

      for (const leg of legs) {
        if (leg.ledgerAccount === 'user_account') {
          const projected = projectedUsers.get(leg.userId);
          projected.available += userAvailableDelta(leg);
          projected.held += userHeldDelta(leg);
          if (projected.available < -0.001 || projected.held < -0.001 || projected.available + projected.held < -0.001) {
            throw new Error('Ledger posting would create a negative user balance');
          }
        } else {
          const next = number(projectedSystems.get(leg.ledgerAccount)) - number(leg.debit) + number(leg.credit);
          if (['contest_clearing', 'suspense', 'platform_revenue'].includes(leg.ledgerAccount) && next < -0.001) {
            throw new Error(`Ledger posting would overdraw protected account: ${leg.ledgerAccount}`);
          }
          projectedSystems.set(leg.ledgerAccount, next);
        }
      }
    }

    const journalEntries = legs.map((leg, index) => ({
      user_id: leg.userId || '',
      match_id: matchId || '',
      wallet_transaction_id: leg.walletTransactionId || walletTransactionId || '',
      ledger_account: leg.ledgerAccount,
      transaction_type: leg.transactionType,
      debit_amount: number(leg.debit),
      credit_amount: number(leg.credit) + number(leg.creditHeld),
      ledger_leg_index: index,
      available_delta: leg.ledgerAccount === 'user_account' ? userAvailableDelta(leg) : 0,
      held_delta: leg.ledgerAccount === 'user_account' ? userHeldDelta(leg) : 0,
      total_wagered_delta: number(leg.totalWageredDelta),
      total_won_delta: number(leg.totalWonDelta),
      total_deposited_delta: number(leg.totalDepositedDelta),
      total_withdrawn_delta: number(leg.totalWithdrawnDelta),
      initiating_actor: actor,
      initiating_actor_id: actorId || '',
      trigger_event: triggerEvent,
      external_reference_type: externalRefType || 'none',
      external_reference_id: externalRefId || '',
      ledger_group_id: groupId,
      correlation_id: correlationId,
      game_id: gameId || '',
      currency: 'USD',
      schema_version: 2,
      launch_epoch: 2,
    }));

    const missingEntries = journalEntries.filter((entry) => !existingIndexes.has(entry.ledger_leg_index));
    if (missingEntries.length) await base44.asServiceRole.entities.LedgerEntry.bulkCreate(missingEntries);

    existing = await base44.asServiceRole.entities.LedgerEntry.filter(
      { ledger_group_id: groupId },
      'ledger_leg_index',
      100
    );
    if (existing.length !== legs.length) throw new Error('ledger_journal_incomplete');

    await rebuildLedgerBalances(base44, {
      userIds: affectedUserIds,
      systemAccounts: affectedSystemAccounts,
    });

    const directionByType = {
      deposit: 'credit',
      withdrawal: 'debit',
      wager_lock: 'reserve',
      wager_refund: 'release',
      payout: 'credit',
      wager_forfeit: 'release',
      service_fee_charge: 'reserve',
      service_fee_refund: 'release',
      withdrawal_fee: 'debit',
      withdrawal_fee_refund: 'credit',
    };
    const requiresExternalRail = ['deposit', 'withdrawal', 'account_closure_disbursement'].includes(triggerEvent);
    const walletTransactionIds = [...new Set(
      legs.map((leg) => leg.walletTransactionId).concat([walletTransactionId]).filter(Boolean)
    )];
    let walletTransaction = null;
    for (const id of walletTransactionIds) {
      try {
        const current = await base44.asServiceRole.entities.WalletTransaction.get(id);
        if (id === walletTransactionId) walletTransaction = current;
        await base44.asServiceRole.entities.WalletTransaction.update(id, {
          status: 'completed',
          currency: 'USD',
          direction: directionByType[current.type] || 'internal',
          correlation_id: correlationId,
          ledger_group_id: groupId,
          source_event: triggerEvent,
          initiating_actor: actor,
          initiating_actor_id: actorId || '',
          processed_at: current.processed_at || new Date().toISOString(),
          retention_until: (() => {
            const deadline = new Date();
            deadline.setUTCFullYear(deadline.getUTCFullYear() + 2);
            const saved = Date.parse(current.retention_until || '');
            return Number.isFinite(saved) && saved > deadline.getTime()
              ? current.retention_until
              : deadline.toISOString();
          })(),
          integration_status: requiresExternalRail ? 'unrouted' : 'internal_complete',
          idempotency_key: current.idempotency_key || `ledger:${groupId}`,
          schema_version: 2,
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: 'wallet_transaction_trace_update_failed',
          wallet_transaction_id: id,
          ledger_group_id: groupId,
          error: error?.message || 'unknown_error',
        }));
      }
    }

    await recordIntegrationEvent(base44, {
      eventType: `financial.${triggerEvent}`,
      aggregateType: walletTransactionId ? 'wallet_transaction' : 'ledger_group',
      aggregateId: walletTransactionId || groupId,
      correlationId,
      idempotencyKey: `ledger:${groupId}`,
      actorType: actor,
      actorId: actorId || '',
      userId: walletTransaction?.user_id || affectedUserIds[0] || '',
      counterpartyUserId: affectedUserIds.find((id) => id !== (walletTransaction?.user_id || affectedUserIds[0])) || '',
      matchId: matchId || '',
      gameId: gameId || '',
      walletTransactionId: walletTransactionId || '',
      ledgerGroupId: groupId,
      status: 'completed',
      amount: walletTransaction?.amount,
      currency: 'USD',
      result: walletTransaction?.type || triggerEvent,
      eventData: {
        ledger_entry_ids: existing.map((entry) => entry.id),
        transaction_type: walletTransaction?.type || '',
        external_reference_type: externalRefType || 'none',
        external_reference_id: externalRefId || '',
        affected_user_ids: affectedUserIds,
        journal_first: true,
      },
    });

    return existing;
  } finally {
    try { await releaseLedgerLock(lockOwner); } catch { /* Lease expiry is the safe fallback. */ }
  }
}

// Moves value between a user's Available and Held balances through the same
// durable journal-first pipeline used for every other money movement.
export async function applyBalanceHold(base44, { userId, amount, direction, matchId, actor = 'administrator', actorId = '', triggerEvent, walletTransactionId = '' }) {
  if (amount <= 0) return null;
  const holding = direction === 'hold';
  return postLedgerLegs(base44, {
    groupId: `${triggerEvent}:${walletTransactionId || matchId || userId}:${holding ? 'hold' : 'release'}`,
    matchId: matchId || '',
    walletTransactionId: walletTransactionId || '',
    actor,
    actorId,
    triggerEvent,
    externalRefType: matchId ? 'match' : 'none',
    externalRefId: matchId || '',
    legs: [{
      ledgerAccount: 'user_account',
      userId,
      debit: amount,
      credit: amount,
      availableDelta: holding ? -amount : amount,
      heldDelta: holding ? amount : -amount,
      transactionType: holding ? 'investigation_hold' : 'investigation_hold_release',
    }],
  });
}
