import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { rebuildLedgerBalances } from '../../shared/ledger.ts';
import { acquireLedgerLock, releaseLedgerLock } from '../../shared/seamlessAtomicStore.ts';

// Scheduled recovery for derived balances. LedgerEntry is the immutable source
// of truth; this sweep repairs any Wallet/SystemLedgerAccount projection left
// stale by an interrupted process after the journal was committed.
Deno.serve(async (req) => {
  const owner = crypto.randomUUID();
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await acquireLedgerLock(owner)) {
      return Response.json({ skipped: true, reason: 'ledger_busy' }, { status: 202 });
    }

    const entries = await base44.asServiceRole.entities.LedgerEntry.filter(
      { launch_epoch: 2 },
      'created_date',
      5000
    );
    const groups = new Map();
    for (const entry of entries) {
      const group = groups.get(entry.ledger_group_id) || { debit: 0, credit: 0 };
      group.debit += Number(entry.debit_amount || 0);
      group.credit += Number(entry.credit_amount || 0);
      groups.set(entry.ledger_group_id, group);
    }
    const unbalancedGroups = [...groups.entries()]
      .filter(([, sums]) => Math.round(sums.debit * 100) !== Math.round(sums.credit * 100))
      .map(([groupId]) => groupId);
    if (unbalancedGroups.length) {
      console.error(JSON.stringify({
        event: 'ledger_journal_unbalanced',
        group_ids: unbalancedGroups.slice(0, 25),
      }));
      return Response.json({
        error: 'ledger_journal_unbalanced',
        group_ids: unbalancedGroups.slice(0, 25),
      }, { status: 409 });
    }

    const userIds = [...new Set(entries.map((entry) => entry.user_id).filter(Boolean))];
    const systemAccounts = [...new Set(
      entries.filter((entry) => entry.ledger_account !== 'user_account').map((entry) => entry.ledger_account)
    )];
    await rebuildLedgerBalances(base44, { userIds, systemAccounts });
    return Response.json({
      repaired: true,
      ledger_groups_checked: groups.size,
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
