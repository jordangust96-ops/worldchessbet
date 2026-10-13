import { allLedgerRows } from '../../shared/ledgerPagination.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { rebuildLedgerBalances } from '../../shared/ledger.ts';
import { acquireLedgerLock, releaseLedgerLock, refreshLedgerLock } from '../../shared/seamlessAtomicStore.ts';

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Scheduled recovery for the atomic journal's derived rows and balances.
// LedgerJournalBatch is one immutable record containing every balanced leg.
// LedgerEntry, Wallet, and SystemLedgerAccount are recoverable projections.
Deno.serve(async (req) => {
  const owner = crypto.randomUUID();
  const startedAt = Date.now();
  let lockHeld = false;
  let leaseTimer;
  let leaseLost = false;
  let stage = 'authenticate';
  const assertLease = async () => {
    if (leaseLost || !await refreshLedgerLock(owner)) {
      leaseLost = true;
      throw new Error('ledger_lease_lost');
    }
  };
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await acquireLedgerLock(owner)) {
      return Response.json({ skipped: true, reason: 'ledger_busy' }, { status: 202 });
    }

    lockHeld = true;
    leaseTimer = setInterval(() => {
      assertLease().catch(() => { leaseLost = true; });
    }, 20000);

    stage = 'read_journal';
    const batches = await allLedgerRows(base44.asServiceRole.entities.LedgerJournalBatch, { launch_epoch: 2 }, 'created_at');
    const snapshot = await allLedgerRows(base44.asServiceRole.entities.LedgerEntry, { launch_epoch: 2 });
    const entriesByGroup = new Map();
    for (const entry of snapshot) {
      const rows = entriesByGroup.get(entry.ledger_group_id) || [];
      rows.push(entry);
      entriesByGroup.set(entry.ledger_group_id, rows);
    }
    // Read each page once instead of querying every batch twice. The global
    // lease keeps this snapshot stable while recovery repairs missing legs.
    const seenBatches = new Set();
    let materializedLegs = 0;
    stage = 'validate_and_repair_entries';
    for (const batch of batches) {
      if (seenBatches.has(batch.ledger_group_id)) throw new Error('duplicate_ledger_journal_batch');
      seenBatches.add(batch.ledger_group_id);
      let legs;
      try {
        legs = JSON.parse(batch.legs_json || '[]');
      } catch {
        throw new Error(`invalid_ledger_batch_json:${batch.ledger_group_id}`);
      }
      if (!Array.isArray(legs) || legs.length !== Number(batch.leg_count)) {
        throw new Error(`invalid_ledger_batch_leg_count:${batch.ledger_group_id}`);
      }
      const debit = legs.reduce((sum, leg) => sum + number(leg.debit_amount), 0);
      const credit = legs.reduce((sum, leg) => sum + number(leg.credit_amount), 0);
      if (
        Math.round(debit * 100) !== Math.round(credit * 100) ||
        Math.round(debit * 100) !== Math.round(number(batch.total_debit) * 100) ||
        Math.round(credit * 100) !== Math.round(number(batch.total_credit) * 100) ||
        legs.some((leg, index) =>
          leg.ledger_group_id !== batch.ledger_group_id ||
          Number(leg.ledger_leg_index) !== index
        )
      ) {
        throw new Error(`invalid_ledger_batch_balance:${batch.ledger_group_id}`);
      }

      const entries = entriesByGroup.get(batch.ledger_group_id) || [];
      const indexes = new Set(entries.map((entry) => Number(entry.ledger_leg_index)));
      if (entries.length > legs.length || indexes.size !== entries.length ||
          entries.some((entry) => !Number.isInteger(Number(entry.ledger_leg_index)) ||
            Number(entry.ledger_leg_index) < 0 || Number(entry.ledger_leg_index) >= legs.length)) {
        throw new Error(`ledger_projection_conflict:${batch.ledger_group_id}`);
      }
      const missing = legs.filter((leg) => !indexes.has(Number(leg.ledger_leg_index)));
      if (missing.length) {
        await assertLease();
        await base44.asServiceRole.entities.LedgerEntry.bulkCreate(missing);
        materializedLegs += missing.length;
        // Only repaired groups need a read-after-write verification.
        const completed = await allLedgerRows(base44.asServiceRole.entities.LedgerEntry,
          { launch_epoch: 2, ledger_group_id: batch.ledger_group_id }, 'ledger_leg_index');
        const completedIndexes = new Set(completed.map((entry) => Number(entry.ledger_leg_index)));
        if (completed.length !== legs.length || completedIndexes.size !== legs.length ||
            legs.some((leg) => !completedIndexes.has(Number(leg.ledger_leg_index)))) {
          throw new Error(`ledger_projection_incomplete:${batch.ledger_group_id}`);
        }
        entriesByGroup.set(batch.ledger_group_id, completed);
      }
    }

    await assertLease();
    const entries = [...entriesByGroup.values()].flat();
    const groups = new Map();
    for (const entry of entries) {
      const group = groups.get(entry.ledger_group_id) || { debit: 0, credit: 0 };
      group.debit += number(entry.debit_amount);
      group.credit += number(entry.credit_amount);
      groups.set(entry.ledger_group_id, group);
    }
    const unbalancedGroups = [...groups.entries()]
      .filter(([, sums]) => Math.round(sums.debit * 100) !== Math.round(sums.credit * 100))
      .map(([groupId]) => groupId);
    if (unbalancedGroups.length) {
      throw new Error(`ledger_journal_unbalanced:${unbalancedGroups.slice(0, 25).join(',')}`);
    }

    const userIds = [...new Set(entries.map((entry) => entry.user_id).filter(Boolean))];
    const systemAccounts = [...new Set(
      entries.filter((entry) => entry.ledger_account !== 'user_account').map((entry) => entry.ledger_account)
    )];
    stage = 'read_balances';
    const wallets = await allLedgerRows(base44.asServiceRole.entities.Wallet, {});
    const accounts = await allLedgerRows(base44.asServiceRole.entities.SystemLedgerAccount, {});
    await assertLease();
    stage = 'rebuild_balances';
    const updated = await rebuildLedgerBalances(base44, {
      userIds, systemAccounts, beforeWrite: assertLease,
      snapshot: { entries, wallets, accounts },
    });
    await assertLease();
    const result = {
      repaired: true,
      atomic_batches_checked: batches.length,
      ledger_groups_checked: groups.size,
      missing_legs_materialized: materializedLegs,
      wallets_materialized: userIds.length,
      system_accounts_materialized: systemAccounts.length,
      ...updated,
      duration_ms: Date.now() - startedAt,
    };
    console.info(JSON.stringify({ event: 'ledger_materialization_recovery_completed', ...result }));
    return Response.json(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'ledger_materialization_recovery_failed',
      error: error?.message || 'unknown_error',
      stage,
      duration_ms: Date.now() - startedAt,
    }));
    const reason = /rate limit/i.test(error?.message || '') ? 'rate_limited'
      : error?.message === 'ledger_lease_lost' ? 'ledger_lease_lost' : 'recovery_failed';
    return Response.json({ error: 'ledger_materialization_recovery_failed', reason, stage }, { status: 500 });
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
    if (lockHeld) {
      try { await releaseLedgerLock(owner); } catch { /* Lease expiry is safe. */ }
    }
  }
});
