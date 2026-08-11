import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const STALE_LEASE_MS = 2 * 60 * 1000;

// Server-side safety net for completed Games whose Match settlement workflow
// was missed or whose pre-ledger settlement worker disappeared. This sweep is
// independent of either player's browser session.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Always prioritize claimed settlements so active live matches can never
    // crowd an abandoned settlement out of the recovery batch. The remaining
    // capacity checks recently-updated in-progress matches for a missed
    // Game-completion workflow.
    const [settlingMatches, inProgressMatches] = await Promise.all([
      base44.asServiceRole.entities.Match.filter({ status: 'settling' }, 'settlement_claimed_at', 50),
      base44.asServiceRole.entities.Match.filter({ status: 'in_progress' }, '-updated_date', 100),
    ]);

    const candidates = [...settlingMatches, ...inProgressMatches];
    const summary = { checked: candidates.length, settled: 0, pending: 0, reconciliation_required: 0, failed: 0 };

    for (const match of candidates) {
      if (match.settlement_hold) continue;

      if (match.status === 'settling') {
        const leaseTimestamp = match.settlement_claimed_at || match.updated_date || match.created_date;
        const leaseAgeMs = Date.now() - new Date(leaseTimestamp || 0).getTime();
        if (!Number.isFinite(leaseAgeMs) || leaseAgeMs < STALE_LEASE_MS) {
          summary.pending += 1;
          continue;
        }
      }

      let game = null;
      if (match.game_id) {
        game = await base44.asServiceRole.entities.Game.get(match.game_id).catch(() => null);
      }
      if (!game) {
        const games = await base44.asServiceRole.entities.Game.filter({ match_id: match.id }, '-created_date', 1);
        game = games[0] || null;
      }
      if (!game || game.status !== 'completed') continue;

      try {
        await base44.asServiceRole.functions.invoke('settleMatch', { gameId: game.id });
        summary.settled += 1;
      } catch (error) {
        const code = error?.response?.data?.error || error?.message || 'unknown_error';
        if (code === 'settlement_in_progress') summary.pending += 1;
        else if (code === 'settlement_reconciliation_required') summary.reconciliation_required += 1;
        else summary.failed += 1;
        console.error(JSON.stringify({
          event: 'settlement_recovery_attempt_failed',
          match_id: match.id,
          game_id: game.id,
          error: String(code).slice(0, 200),
        }));
      }
    }

    return Response.json(summary);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'settlement_recovery_sweep_failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
