import { guardGameMutations } from '../../shared/gameMutationGuard.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { checkDisconnectTimeout, getDisconnectState } from '../../shared/disconnectPolicy.js';

Deno.serve(async (req) => {
  try {
    const base44 = guardGameMutations(createClientFromRequest(req), { waitForLease: true });
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { gameId } = await req.json();
    if (!gameId) return Response.json({ error: 'gameId is required' }, { status: 400 });
    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });
    if (Number(game.launch_epoch) !== 2) return Response.json({ error: 'Game not available' }, { status: 410 });
    const match = await base44.asServiceRole.entities.Match.get(game.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
    if (![match.player1_id, match.player2_id].includes(user.id))
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    if (game.status !== 'active') return Response.json({ game, server_now_ms: Date.now() });

    const color = match.player1_id === user.id ? 'white' : 'black';
    const now = Date.now();
    // Record the returning player FIRST. They may resume until the result has
    // actually committed; a late heartbeat can never reopen a completed game.
    const disconnectedAt = Date.parse(game[color + '_disconnected_at'] || '');
    const updated = await base44.asServiceRole.entities.Game.update(game.id, {
      [color + '_last_seen_at']: new Date(now).toISOString(),
      [color + '_disconnected_at']: '',
      [color + '_disconnect_policy_version']: '',
      ...(Number.isFinite(disconnectedAt) ? {
        [color + '_reconnected_at']: new Date(now).toISOString(),
        [color + '_total_disconnected_ms']: Math.max(0, Number(game[color + '_total_disconnected_ms']) || 0) + Math.max(0, now - disconnectedAt),
      } : {}),
      ...(game.disconnect_timeout_candidate_color === color ? {
        disconnect_timeout_candidate_at: '', disconnect_timeout_candidate_color: '',
      } : {}),
    });
    const result = await checkDisconnectTimeout(base44, updated, match, now);
    const latest = result.game || updated;
    return Response.json({ game: latest, server_now_ms: Date.now(), disconnect: getDisconnectState(match, latest) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
});
