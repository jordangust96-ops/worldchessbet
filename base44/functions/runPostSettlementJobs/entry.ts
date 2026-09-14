import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { isFreeMatch, assertFreeMatch } from '../../shared/challengePolicy.js';

// Runs post-settlement integrity work outside the player-facing settlement
// response. Each job is isolated so an unavailable analyzer or a rule-check
// failure cannot prevent the other job from being attempted.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const { matchId, gameId } = await req.json();
    if (!matchId || !gameId) {
      return Response.json({ error: 'matchId and gameId are required' }, { status: 400 });
    }

    const [match, game] = await Promise.all([
      base44.asServiceRole.entities.Match.get(matchId),
      base44.asServiceRole.entities.Game.get(gameId),
    ]);
    if (!match || !game || game.match_id !== match.id) {
      return Response.json({ error: 'Match or Game not found' }, { status: 404 });
    }
    if (match.status !== 'completed' || game.status !== 'completed') {
      return Response.json({ error: 'post_settlement_jobs_require_completed_contest' }, { status: 409 });
    }

    if (isFreeMatch(match)) {
      assertFreeMatch(match);
      if (game.play_mode !== 'free' || match.game_id !== game.id) {
        return Response.json({ error: 'invalid_free_contest' }, { status: 409 });
      }
      // Keep lightweight abuse checks, then request ratings immediately.
      // Neither job is part of the player's game-completion response.
      const integrity = await base44.asServiceRole.functions.invoke('runIntegrityCheck', { matchId, gameId })
        .then(() => 'completed', () => 'failed');
      const rating = await base44.asServiceRole.functions.invoke('processEligibleRatings', {});
      return Response.json({ accepted: true, jobs: {
        integrity, fair_play_analysis: 'skipped_free_game',
        ratings: rating?.data?.disabled ? 'disabled' : rating?.data?.deferred || rating?.data?.errors?.length ? 'deferred' : 'processed',
      } });
    }

    const results = await Promise.allSettled([
      base44.asServiceRole.functions.invoke('runIntegrityCheck', { matchId, gameId }),
      base44.asServiceRole.functions.invoke('requestFairPlayAnalysis', { matchId, gameId }),
    ]);

    const jobs = {
      integrity: results[0].status === 'fulfilled' ? 'completed' : 'failed',
      fair_play_analysis: results[1].status === 'fulfilled' ? 'completed' : 'failed',
    };

    if (results.some((result) => result.status === 'rejected')) {
      console.error(JSON.stringify({
        event: 'post_settlement_job_failed',
        match_id: matchId,
        game_id: gameId,
        jobs,
      }));
    }

    return Response.json({ accepted: true, jobs });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'post_settlement_dispatch_failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
