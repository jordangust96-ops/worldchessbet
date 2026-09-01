import { recordIntegrationEvent } from './integrationEvents.ts';
import {
  acquireFinancialLedgerLock, releaseFinancialLedgerLock,
  claimFinancialOperation, saveFinancialOperation,
} from './financialAtomicStore.ts';

const EPSILON = 0.001;
const INCOMPLETE = ['pending', 'posting', 'projecting'];

function rounded(value) { return Math.round(Number(value || 0) * 100) / 100; }
function stablePlanHash(value) {
  const source = JSON.stringify(value);
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}
function assertBalanced(legs) {
  if (!Array.isArray(legs) || legs.length < 2) throw new Error('Invalid ledger posting request');
  for (const leg of legs) {
    for (const amount of [leg.debit || 0, leg.credit || 0, leg.heldDelta || 0]) {
      if (!Number.isFinite(amount)) throw new Error('Ledger amount must be finite');
    }
    if ((leg.debit || 0) < 0 || (leg.credit || 0) < 0) throw new Error('Ledger debit and credit amounts cannot be negative');
  }
  const debits = rounded(legs.reduce((sum, leg) => sum + (leg.debit || 0), 0));
  const credits = rounded(legs.reduce((sum, leg) => sum + (leg.credit || 0), 0));
  if (debits !== credits) throw new Error(`Unbalanced ledger legs: debit=${debits} credit=${credits}`);
}
function normalizePlan({ operationId, groupId, matchId, gameId, walletTransactionId, actor, actorId, triggerEvent, externalRefType, externalRefId, legs }) {
  return {
    operation_id: operationId, ledger_group_id: groupId, match_id: matchId || '', game_id: gameId || '',
    wallet_transaction_id: walletTransactionId || '', actor, actor_id: actorId || '', trigger_event: triggerEvent,
    external_reference_type: externalRefType || 'none', external_reference_id: externalRefId || '',
    legs: legs.map((leg, leg_index) => ({
      leg_index, ledger_account: leg.ledgerAccount, user_id: leg.userId || '',
      debit: rounded(leg.debit), credit: rounded(leg.credit), held_delta: rounded(leg.heldDelta),
      transaction_type: leg.transactionType,
      total_wagered_delta: rounded(leg.totalWageredDelta),
      total_won_delta: rounded(leg.totalWonDelta),
      total_deposited_delta: rounded(leg.totalDepositedDelta),
      total_withdrawn_delta: rounded(leg.totalWithdrawnDelta),
    })),
  };
}
async function loadSnapshots(base44, plan) {
  const snapshots = { wallets: {}, systems: {} };
  for (const leg of plan.legs) {
    if (leg.ledger_account === 'user_account' && !snapshots.wallets[leg.user_id]) {
      let wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: leg.user_id }))[0];
      if (!wallet) wallet = await base44.asServiceRole.entities.Wallet.create({
        user_id: leg.user_id, balance: 0, available_balance: 0, held_balance: 0, total_balance: 0,
        total_wagered: 0, total_won: 0, total_deposited: 0, total_withdrawn: 0,
      });
      snapshots.wallets[leg.user_id] = {
        id: wallet.id, available_balance: Number(wallet.available_balance || 0), held_balance: Number(wallet.held_balance || 0),
        total_wagered: Number(wallet.total_wagered || 0), total_won: Number(wallet.total_won || 0),
        total_deposited: Number(wallet.total_deposited || 0), total_withdrawn: Number(wallet.total_withdrawn || 0),
      };
    }
    if (leg.ledger_account !== 'user_account' && !snapshots.systems[leg.ledger_account]) {
      let account = (await base44.asServiceRole.entities.SystemLedgerAccount.filter({ account_name: leg.ledger_account }))[0];
      if (!account) account = await base44.asServiceRole.entities.SystemLedgerAccount.create({ account_name: leg.ledger_account, balance: 0 });
      snapshots.systems[leg.ledger_account] = { id: account.id, balance: Number(account.balance || 0) };
    }
  }
  return snapshots;
}
function deriveTargets(plan, snapshots) {
  const wallets = structuredClone(snapshots.wallets || {});
  const systems = structuredClone(snapshots.systems || {});
  for (const leg of plan.legs) {
    if (leg.ledger_account === 'user_account') {
      const row = wallets[leg.user_id];
      row.available_balance = rounded(row.available_balance - leg.debit + leg.credit);
      row.held_balance = rounded(row.held_balance + leg.held_delta);
      row.total_wagered = rounded(row.total_wagered + leg.total_wagered_delta);
      row.total_won = rounded(row.total_won + leg.total_won_delta);
      row.total_deposited = rounded(row.total_deposited + leg.total_deposited_delta);
      row.total_withdrawn = rounded(row.total_withdrawn + leg.total_withdrawn_delta);
    } else {
      systems[leg.ledger_account].balance = rounded(systems[leg.ledger_account].balance - leg.debit + leg.credit);
    }
  }
  for (const row of Object.values(wallets)) {
    row.total_balance = rounded(row.available_balance + row.held_balance);
    row.balance = row.available_balance;
    if (row.available_balance < -EPSILON || row.held_balance < -EPSILON || row.total_balance < -EPSILON) {
      throw new Error('Ledger posting would create a negative user balance');
    }
  }
  for (const [name, row] of Object.entries(systems)) {
    if (['contest_clearing', 'suspense', 'platform_revenue'].includes(name) && row.balance < -EPSILON) {
      throw new Error(`Ledger posting would overdraw protected account: ${name}`);
    }
  }
  return { wallets, systems };
}
async function findOperation(base44, operationId) {
  return (await base44.asServiceRole.entities.LedgerOperation.filter({ operation_id: operationId }, 'created_date', 5))[0] || null;
}
async function assertNoOtherIncompleteOperation(base44, operationId) {
  for (const status of INCOMPLETE) {
    const rows = await base44.asServiceRole.entities.LedgerOperation.filter({ status }, 'created_date', 20);
    if (rows.some((row) => row.operation_id !== operationId)) {
      throw new Error('A prior financial ledger operation requires reconciliation before another operation can post');
    }
  }
}
async function writeMissingLegs(base44, plan, snapshots) {
  const existing = await base44.asServiceRole.entities.LedgerEntry.filter({ ledger_group_id: plan.ledger_group_id }, 'leg_index', 100);
  const byIndex = new Map();
  for (const entry of existing) {
    if (entry.operation_id !== plan.operation_id || !Number.isInteger(entry.leg_index) || byIndex.has(entry.leg_index)) {
      throw new Error('Ledger group contains ambiguous immutable leg evidence');
    }
    byIndex.set(entry.leg_index, entry);
  }
  for (const leg of plan.legs) {
    if (byIndex.has(leg.leg_index)) continue;
    const wallet = leg.ledger_account === 'user_account' ? snapshots.wallets[leg.user_id] : null;
    const system = leg.ledger_account === 'user_account' ? null : snapshots.systems[leg.ledger_account];
    await base44.asServiceRole.entities.LedgerEntry.create({
      user_id: leg.user_id, match_id: plan.match_id, wallet_transaction_id: plan.wallet_transaction_id,
      ledger_account: leg.ledger_account, transaction_type: leg.transaction_type,
      debit_amount: leg.debit, credit_amount: leg.credit,
      resulting_available_balance: wallet ? rounded(wallet.available_balance - leg.debit + leg.credit) : undefined,
      resulting_held_balance: wallet ? rounded(wallet.held_balance + leg.held_delta) : undefined,
      resulting_total_balance: wallet ? rounded(wallet.available_balance - leg.debit + leg.credit + wallet.held_balance + leg.held_delta) : rounded(system.balance - leg.debit + leg.credit),
      initiating_actor: plan.actor, initiating_actor_id: plan.actor_id, trigger_event: plan.trigger_event,
      external_reference_type: plan.external_reference_type, external_reference_id: plan.external_reference_id,
      ledger_group_id: plan.ledger_group_id, operation_id: plan.operation_id, leg_index: leg.leg_index,
      available_delta: leg.ledger_account === 'user_account' ? rounded(-leg.debit + leg.credit) : 0,
      held_delta: leg.ledger_account === 'user_account' ? leg.held_delta : 0,
      total_wagered_delta: leg.total_wagered_delta, total_won_delta: leg.total_won_delta,
      total_deposited_delta: leg.total_deposited_delta, total_withdrawn_delta: leg.total_withdrawn_delta,
      correlation_id: plan.match_id || plan.wallet_transaction_id || plan.ledger_group_id, game_id: plan.game_id,
      currency: 'USD', schema_version: 2,
    });
  }
  const complete = await base44.asServiceRole.entities.LedgerEntry.filter({ ledger_group_id: plan.ledger_group_id }, 'leg_index', 100);
  if (complete.length !== plan.legs.length || rounded(complete.reduce((sum, row) => sum + Number(row.debit_amount || 0), 0)) !== rounded(complete.reduce((sum, row) => sum + Number(row.credit_amount || 0), 0))) {
    throw new Error('Immutable ledger group is incomplete or unbalanced');
  }
  return complete;
}

// Immutable entries are written before projections. LedgerOperation is the
// durable commit marker: only completed operations are financially authoritative.
// Projections are exact, rebuildable cache values derived from its pre-image +
// the immutable leg deltas; a retry therefore never incrementally applies twice.
export async function postLedgerLegs(base44, input) {
  const groupId = input.groupId;
  const operationId = input.operationId || groupId;
  if (!groupId || !operationId) throw new Error('A stable ledger operation ID is required');
  assertBalanced(input.legs);
  const plan = normalizePlan({ ...input, groupId, operationId });
  const planHash = stablePlanHash(plan);
  const owner = crypto.randomUUID();
  if (!await acquireFinancialLedgerLock(owner)) throw new Error('financial_ledger_busy');

  try {
    const atomic = await claimFinancialOperation(operationId, planHash);
    let operation = await findOperation(base44, operationId);
    if (operation?.plan_hash && operation.plan_hash !== planHash) throw new Error('Financial operation ID reuse has a different plan');
    if (operation?.status === 'completed') {
      return await base44.asServiceRole.entities.LedgerEntry.filter({ ledger_group_id: groupId }, 'leg_index', 100);
    }
    await assertNoOtherIncompleteOperation(base44, operationId);

    let snapshots = parseJson(operation?.projection_before_json, null);
    if (!snapshots) snapshots = await loadSnapshots(base44, plan);
    if (!operation) {
      operation = await base44.asServiceRole.entities.LedgerOperation.create({
        operation_id: operationId, ledger_group_id: groupId, status: 'posting', expected_leg_count: plan.legs.length,
        plan_hash: planHash, plan_json: JSON.stringify(plan), projection_before_json: JSON.stringify(snapshots),
        wallet_transaction_id: plan.wallet_transaction_id, match_id: plan.match_id, game_id: plan.game_id,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    } else {
      await base44.asServiceRole.entities.LedgerOperation.update(operation.id, { status: 'posting', updated_at: new Date().toISOString(), last_error: '' });
    }
    await saveFinancialOperation(operationId, { ...atomic, state: 'posting', ledger_group_id: groupId });

    const entries = await writeMissingLegs(base44, plan, snapshots);
    operation = await findOperation(base44, operationId);
    await base44.asServiceRole.entities.LedgerOperation.update(operation.id, { status: 'projecting', updated_at: new Date().toISOString() });

    const targets = deriveTargets(plan, snapshots);
    for (const row of Object.values(targets.wallets)) {
      await base44.asServiceRole.entities.Wallet.update(row.id, row);
    }
    for (const row of Object.values(targets.systems)) {
      await base44.asServiceRole.entities.SystemLedgerAccount.update(row.id, { balance: row.balance });
    }

    let walletTransaction = null;
    if (plan.wallet_transaction_id) {
      walletTransaction = await base44.asServiceRole.entities.WalletTransaction.get(plan.wallet_transaction_id).catch(() => null);
      if (walletTransaction) {
        const directionByType = { deposit: 'credit', withdrawal: 'debit', wager_lock: 'reserve', wager_refund: 'release', payout: 'credit', service_fee_charge: 'reserve', service_fee_refund: 'release' };
        await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, {
          status: 'completed', currency: 'USD', direction: directionByType[walletTransaction.type] || 'internal',
          correlation_id: plan.match_id || plan.wallet_transaction_id || groupId, ledger_group_id: groupId,
          source_event: plan.trigger_event, initiating_actor: plan.actor, initiating_actor_id: plan.actor_id,
          processed_at: new Date().toISOString(), integration_status: 'internal_complete',
          idempotency_key: walletTransaction.idempotency_key || `ledger:${operationId}`, schema_version: 2,
        });
      }
    }

    operation = await findOperation(base44, operationId);
    await base44.asServiceRole.entities.LedgerOperation.update(operation.id, {
      status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await saveFinancialOperation(operationId, { ...atomic, state: 'completed', ledger_group_id: groupId });

    try {
      const affectedUserIds = [...new Set(plan.legs.map((leg) => leg.user_id).filter(Boolean))];
      await recordIntegrationEvent(base44, {
        eventType: `financial.${plan.trigger_event}`, aggregateType: plan.wallet_transaction_id ? 'wallet_transaction' : 'ledger_group',
        aggregateId: plan.wallet_transaction_id || groupId, correlationId: plan.match_id || plan.wallet_transaction_id || groupId,
        idempotencyKey: `ledger:${operationId}`, actorType: plan.actor, actorId: plan.actor_id,
        userId: walletTransaction?.user_id || affectedUserIds[0] || '', matchId: plan.match_id, gameId: plan.game_id,
        walletTransactionId: plan.wallet_transaction_id, ledgerGroupId: groupId, status: 'completed',
        amount: walletTransaction?.amount, currency: 'USD', result: walletTransaction?.type || plan.trigger_event,
        eventData: { ledger_entry_ids: entries.map((entry) => entry.id), operation_id: operationId, affected_user_ids: affectedUserIds },
      });
    } catch { /* Non-authoritative outbox failures must never roll back money. */ }

    return entries;
  } catch (error) {
    const operation = await findOperation(base44, operationId).catch(() => null);
    if (operation && operation.status !== 'completed') {
      await base44.asServiceRole.entities.LedgerOperation.update(operation.id, {
        status: 'review_required', updated_at: new Date().toISOString(),
        last_error: String(error?.message || 'unknown').slice(0, 1000),
      }).catch(() => {});
    }
    throw error;
  } finally {
    try { await releaseFinancialLedgerLock(owner); } catch { /* lock expires after crash */ }
  }
}