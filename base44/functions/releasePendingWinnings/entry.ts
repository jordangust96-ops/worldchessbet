import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { applyBalanceHold } from '../../shared/ledger.ts';

// System sweep (invoked on a schedule — no user session involved, so this
// never checks auth.me()): releases a winner's payout out of Held Balance
// into Available Balance once the 24-hour contest reporting window
// (submitContestReport) has passed with no report filed and no open Fair
// Play / settlement-integrity flag against the winner for this match.
//
// settleMatch credits every decisive-result payout into Held Balance (see
// its 'creditHeld' leg and the doc comment above its Deno.serve handler)
// instead of Available Balance, and stamps payout_hold_status: 'held' plus
// payout_release_at (now + 24h) on the winner's WalletTransaction at the
// moment of creation. This sweep is the other half of that: it is what
// actually makes the money spendable/withdrawable when nothing intervened.
//
// If a DisputeCase exists for the match, this leaves the hold in place —
// resolving that case (manageDisputeCase's resolve_case) is what decides
// whether the payout is released or reversed. If no case exists but an open
// engine_assistance_suspected or settlement_reconciliation_required
// IntegrityFlag exists for the winner on this match — an autonomous
// Stockfish/reconciliation flag with no player report — this also leaves
// the hold in place, so an admin has a chance to act (see
// manageIntegrityFlag's open_case action) before the money becomes
// withdrawable. Clearing that flag (mark_cleared) or converting it into a
// case both give the admin an explicit way to resolve this either direction.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const heldPayouts = await base44.asServiceRole.entities.WalletTransaction.filter(
      { type: 'payout', payout_hold_status: 'held' },
      '-created_date',
      200
    );

    const now = Date.now();
    const releasedIds = [];

    for (const candidate of heldPayouts) {
      const releaseAtMs = candidate.payout_release_at ? new Date(candidate.payout_release_at).getTime() : NaN;
      if (!Number.isFinite(releaseAtMs) || now < releaseAtMs) continue;
      if (!candidate.match_id || !candidate.user_id || !(candidate.amount > 0)) continue;

      // Re-fetch fresh state before doing any further work — never act on
      // the query snapshot above, which can be stale by the time a later
      // candidate in a large sweep is reached (an admin could have resolved
      // a case, or a previous sweep run could already have released this
      // exact transaction).
      const transaction = await base44.asServiceRole.entities.WalletTransaction.get(candidate.id);
      if (!transaction || transaction.payout_hold_status !== 'held') continue;

      const [openCases, flags] = await Promise.all([
        base44.asServiceRole.entities.DisputeCase.filter({ match_id: transaction.match_id }),
        base44.asServiceRole.entities.IntegrityFlag.filter({ match_id: transaction.match_id, user_id: transaction.user_id }),
      ]);
      const hasOpenCase = openCases.some((c) => !['resolved', 'closed'].includes(c.status));
      if (hasOpenCase) continue;
      const hasOpenFairPlayFlag = flags.some(
        (f) =>
          ['engine_assistance_suspected', 'settlement_reconciliation_required'].includes(f.flag_type) &&
          ['open', 'under_review'].includes(f.status)
      );
      if (hasOpenFairPlayFlag) continue;

      // Final guard, taken fresh right before committing: the same race this
      // whole sweep exists to close still applies between the checks above
      // and this write (a case or flag could appear, or an admin could
      // resolve/consume this exact hold, in that window).
      const preCommit = await base44.asServiceRole.entities.WalletTransaction.get(transaction.id);
      if (!preCommit || preCommit.payout_hold_status !== 'held') continue;

      await applyBalanceHold(base44, {
        userId: transaction.user_id,
        amount: transaction.amount,
        direction: 'release',
        matchId: transaction.match_id,
        actor: 'system',
        triggerEvent: 'pending_winnings_auto_release',
      });
      await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, { payout_hold_status: 'released' });
      releasedIds.push(transaction.id);
    }

    return Response.json({ releasedCount: releasedIds.length, releasedIds });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
