import { allLedgerRows } from '../../shared/ledgerPagination.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { rebuildLedgerBalances } from '../../shared/ledger.ts';
import { acquireLedgerLock, releaseLedgerLock } from '../../shared/seamlessAtomicStore.ts';

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Scheduled recovery for the atomic journal's derived rows and balances.
// LedgerJournalBatch is one immutable record containing every balanced leg.
// LedgerEntry, Wallet, and SystemLedgerAccount are recoverable projections.
Deno.serve(async (req) => {
  const owner = crypto.randomUUID();
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await acquireLedgerLock(owner)) {
      return Response.json({ skipped: true, reason: 'ledger_busy' }, { status: 202 });
    }

    const batches = await allLedgerRows(base44.asServiceRole.entities.LedgerJournalBatch, { launch_epoch: 2 }, 'created_at');
    let materializedLegs = 0;
    for (const batch of batches) {
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

      const entries = await base44.asServiceRole.entities.LedgerEntry.filter(
        { ledger_group_id: batch.ledger_group_id },
        'ledger_leg_index',
        100
      );
      const indexes = new Set(entries.map((entry) => Number(entry.ledger_leg_index)));
      if (entries.length > legs.length || indexes.size !== entries.length) {
        throw new Error(`ledger_projection_conflict:${batch.ledger_group_id}`);
      }
      const missing = legs.filter((leg) => !indexes.has(Number(leg.ledger_leg_index)));
      if (missing.length) {
        await base44.asServiceRole.entities.LedgerEntry.bulkCreate(missing);
        materializedLegs += missing.length;
      }
      const completed = await base44.asServiceRole.entities.LedgerEntry.filter(
        { ledger_group_id: batch.ledger_group_id },
        'ledger_leg_index',
        100
      );
      if (completed.length !== legs.length) {
        throw new Error(`ledger_projection_incomplete:${batch.ledger_group_id}`);
      }
    }

    const entries = await allLedgerRows(base44.asServiceRole.entities.LedgerEntry, { launch_epoch: 2 });
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
    await rebuildLedgerBalances(base44, { userIds, systemAccounts });
    return Response.json({
      repaired: true,
      atomic_batches_checked: batches.length,
      ledger_groups_checked: groups.size,
      missing_legs_materialized: materializedLegs,
      wallets_materialized: userIds.length,
      system_accounts_materialized: systemAccounts.length,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'ledger_materialization_recovery_failed',
      error: error?.message || 'unknown_error',
    }));
    return Response.json({ error: 'ledger_materialization_recovery_failed' }, { status: 500 });
  } finally {
    try { await releaseLedgerLock(owner); } catch { /* Lease expiry is safe. */ }
  }
});
