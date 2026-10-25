import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  DISCONNECT_POLICY_VERSION,
  HEARTBEAT_STALE_MS,
  checkDisconnectTimeout,
} from '../../shared/disconnectPolicy.js';

// Server-authoritative presence tracking for an active Game. The heartbeat is
// a connectivity signal only: a missed heartbeat does not prove intent. The
// time-control-specific reconnect window is resolved separately by the shared
// disconnect policy and the scheduled safety sweep.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { gameId } = await req.json();
    if (!gameId) return Response.json({ error: 'gameId is required' }, { status: 400 });

    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });
    if (Number(game.launch_epoch) !== 2) return Response.json({ error: 'Game not available' }, { status: 410 });

    if (game.status === 'completed') {
      return Response.json({ game });
    }

    const match = await base44.asServiceRole.entities.Match.get(game.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    const myColor = isP1 ? 'white' : 'black';
    const opponentColor = isP1 ? 'black' : 'white';
    const now = new Date();
    const nowIso = now.toISOString();

    const updates = { [`${myColor}_last_seen_at`]: nowIso };

    // A returning heartbeat cancels any pending reconnect timeout. New policy
    // timestamps are recorded when the server observes staleness, not
    // backdated to the last beat, so this window cannot expire early.
    const myDisconnectedAt = game[`${myColor}_disconnected_at`];
    if (myDisconnectedAt) {
      const durationMs = Math.max(0, now.getTime() - new Date(myDisconnectedAt).getTime());
      updates[`${myColor}_disconnected_at`] = '';
      updates[`${myColor}_disconnect_policy_version`] = '';
      updates[`${myColor}_reconnected_at`] = nowIso;
      updates[`${myColor}_total_disconnected_ms`] = (game[`${myColor}_total_disconnected_ms`] || 0) + durationMs;
    }
    if (game.disconnect_timeout_candidate_color === myColor) {
      updates.disconnect_timeout_candidate_at = '';
      updates.disconnect_timeout_candidate_color = '';
    }

    // A connected player's heartbeat detects a stale opponent. Start the
    // reconnect period at this observation time, not at a reconstructed or
    // backdated estimate of when the network first failed.
    const opponentLastSeenAt = game[`${opponentColor}_last_seen_at`];
    const opponentAlreadyDisconnected = !!game[`${opponentColor}_disconnected_at`];
    if (!opponentAlreadyDisconnected && opponentLastSeenAt) {
      const sinceLastSeen = now.getTime() - new Date(opponentLastSeenAt).getTime();
      if (sinceLastSeen > HEARTBEAT_STALE_MS) {
        updates[`${opponentColor}_disconnected_at`] = nowIso;
        updates[`${opponentColor}_disconnect_policy_version`] = DISCONNECT_POLICY_VERSION;
        updates.disconnect_timeout_candidate_at = '';
        updates.disconnect_timeout_candidate_color = '';
      }
    }

    const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, updates);
    const timeoutCheck = await checkDisconnectTimeout(base44, updatedGame, match, now.getTime());
    return Response.json({ game: timeoutCheck.game || updatedGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
