import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

function parseServerTime(dateStr, fallbackMs) {
  if (!dateStr) return fallbackMs;
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(dateStr);
  const parsedMs = new Date(hasTz ? dateStr : `${dateStr}Z`).getTime();
  return Number.isFinite(parsedMs) ? parsedMs : fallbackMs;
}

function finiteMs(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

// Returns a participant-authorized, server-calculated clock snapshot. This is
// intentionally read-only: it never changes time, game state, or outcomes.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { gameId } = await req.json();
    if (!gameId) return Response.json({ error: 'gameId is required' }, { status: 400 });

    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });

    const match = await base44.asServiceRole.entities.Match.get(game.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isParticipant = match.player1_id === user.id || match.player2_id === user.id;
    if (!isParticipant && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const now = Date.now();
    const activeColor = game.fen?.split(' ')[1] === 'b' ? 'b' : 'w';
    const turnStartedAt = parseServerTime(game.turn_started_at, now);
    const elapsedMs = game.status === 'completed' ? 0 : Math.max(0, now - turnStartedAt);
    const whiteStoredMs = finiteMs(game.white_time_ms);
    const blackStoredMs = finiteMs(game.black_time_ms);

    return Response.json({
      game_id: game.id,
      status: game.status,
      active_color: activeColor,
      white_remaining_ms: activeColor === 'w' ? Math.max(0, whiteStoredMs - elapsedMs) : whiteStoredMs,
      black_remaining_ms: activeColor === 'b' ? Math.max(0, blackStoredMs - elapsedMs) : blackStoredMs,
      server_now: new Date(now).toISOString(),
      server_now_ms: now,
      turn_started_at: game.turn_started_at || null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Clock synchronization failed' }, { status: 500 });
  }
});
