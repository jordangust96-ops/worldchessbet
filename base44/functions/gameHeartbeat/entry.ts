import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// If no heartbeat has been received from a player for longer than this, the
// opponent's own heartbeat call (the only trigger point available, since
// there is no persistent server process) marks that player disconnected.
// Recommended heartbeat cadence on the client is ~8s, so this comfortably
// tolerates a couple of missed beats before recording a disconnect.
const HEARTBEAT_STALE_MS = 20000;

// Server-authoritative presence tracking for an active Game. Called
// periodically by both players while a match is in progress. Two things
// happen on every call:
//  1. The caller's own last-seen timestamp is refreshed, and if they had
//     previously been marked disconnected, that is now recorded as a
//     reconnect (audit only â€” never grants extra thinking time).
//  2. As a side effect, the opponent's staleness is checked and, if they've
//     gone quiet longer than HEARTBEAT_STALE_MS, they are marked
//     disconnected server-side. This piggybacks disconnect *detection* onto
//     whichever player still has a live connection, with no separate
//     scheduled job required.
// The chess clock (turn_started_at + white/black_time_ms) remains the sole
// authority over any timeout outcome â€” nothing here ever changes status,
// result, winner_id, or clock values.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { gameId } = await req.json();
    if (!gameId) return Response.json({ error: 'gameId is required' }, { status: 400 });

    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });

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

    // I'm reconnecting if I had previously been recorded as disconnected.
    const myDisconnectedAt = game[`${myColor}_disconnected_at`];
    if (myDisconnectedAt) {
      const durationMs = Math.max(0, now.getTime() - new Date(myDisconnectedAt).getTime());
      updates[`${myColor}_disconnected_at`] = '';
      updates[`${myColor}_reconnected_at`] = nowIso;
      updates[`${myColor}_total_disconnected_ms`] = (game[`${myColor}_total_disconnected_ms`] || 0) + durationMs;
    }

    // Detect the opponent's disconnect as a side effect of my heartbeat.
    const opponentLastSeenAt = game[`${opponentColor}_last_seen_at`];
    const opponentAlreadyDisconnected = !!game[`${opponentColor}_disconnected_at`];
    if (!opponentAlreadyDisconnected && opponentLastSeenAt) {
      const sinceLastSeen = now.getTime() - new Date(opponentLastSeenAt).getTime();
      if (sinceLastSeen > HEARTBEAT_STALE_MS) {
        // Back-date to when they actually went quiet, not to "now", for an
        // accurate audit trail.
        updates[`${opponentColor}_disconnected_at`] = new Date(
          new Date(opponentLastSeenAt).getTime() + HEARTBEAT_STALE_MS
        ).toISOString();
      }
    }

    const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, updates);
    return Response.json({ game: updatedGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});