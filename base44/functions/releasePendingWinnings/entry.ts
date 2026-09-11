import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { applyBalanceHold } from '../../shared/ledger.ts';
import { allLedgerRows } from '../../shared/ledgerPagination.ts';
import { REPORT_WINDOW_MS } from '../../shared/reportWindow.ts';

// The only writer that releases automatic pending winnings. Admin actions
// resolve cases/flags; this sweep enforces the deadline even after resolution.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const cutoff = new Date().toISOString();
    // Collect all due candidates before changing their status, so offset
    // pagination cannot skip rows removed from the held set by this sweep.
    const heldPayouts = await allLedgerRows(base44.asServiceRole.entities.WalletTransaction,
      { type: 'payout', status: 'completed', payout_hold_status: 'held',
        payout_release_at: { $lte: cutoff } }, 'payout_release_at');
    const releasedIds = [];
    const failedIds = [];
    for (const candidate of heldPayouts) {
      if (!candidate.match_id || !candidate.user_id || !(candidate.amount > 0)) continue;
      try {
        const entries = await applyBalanceHold(base44, {
          userId: candidate.user_id, amount: candidate.amount, direction: 'release',
          matchId: candidate.match_id, actor: 'system',
          triggerEvent: 'pending_winnings_auto_release', walletTransactionId: candidate.id,
          // Preserve the settlement transaction's original timestamp and linkage.
          updateTransactions: false,
          beforePost: async () => {
            const tx = await base44.asServiceRole.entities.WalletTransaction.get(candidate.id);
            if (!tx || tx.status !== 'completed' || tx.payout_hold_status !== 'held') return false;
            if (tx.amount !== candidate.amount || tx.user_id !== candidate.user_id || tx.match_id !== candidate.match_id) return false;
            const [cases, flags, records] = await Promise.all([
              allLedgerRows(base44.asServiceRole.entities.DisputeCase, { match_id: tx.match_id }),
              allLedgerRows(base44.asServiceRole.entities.IntegrityFlag, { match_id: tx.match_id, user_id: tx.user_id }),
              allLedgerRows(base44.asServiceRole.entities.ContestRecord, { match_id: tx.match_id }),
            ]);
            const releaseAt = Date.parse(tx.payout_release_at || '');
            const settledAt = Date.parse(records[0]?.settlement_timestamp || '');
            if (!Number.isFinite(releaseAt) || !Number.isFinite(settledAt)) return false;
            // Reporting starts at the permanent settlement record, which can
            // be later than payout creation. Both deadlines must have elapsed.
            if (Date.now() <= Math.max(releaseAt, settledAt + REPORT_WINDOW_MS)) return false;
            const hasOpenCase = cases.some(c => !['resolved', 'closed'].includes(c.status));
            if (hasOpenCase) return false;
            if (flags.some(f => ['open', 'under_review'].includes(f.status) &&
              (f.flag_type === 'settlement_reconciliation_required' ||
                (f.flag_type === 'engine_assistance_suspected' && f.severity !== 'low')))) return false;
            return true;
          },
          // Mark released before relinquishing the ledger lock. If this write
          // fails, the same deterministic group repairs the posting on retry.
          afterPost: async () => {
            await base44.asServiceRole.entities.WalletTransaction.update(candidate.id, { payout_hold_status: 'released' });
          },
        });
        if (entries) releasedIds.push(candidate.id);
      } catch (error) {
        failedIds.push(candidate.id);
        console.error(JSON.stringify({ event: 'pending_winnings_release_failed',
          wallet_transaction_id: candidate.id, error: error?.message || 'unknown_error' }));
      }
    }
    return Response.json({ releasedCount: releasedIds.length, releasedIds, failedIds });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
