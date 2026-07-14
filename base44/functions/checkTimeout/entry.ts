import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

    if (match.player1_id !== user.id && match.player2_id !== user.id) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    // Determine side to move from FEN, and check if their authoritative clock has expired.
    const sideToMove = game.fen?.split(' ')[1] === 'b' ? 'b' : 'w';
    const now = Date.now();
    const turnStartedAt = game.turn_started_at ? new Date(game.turn_started_at).getTime() : now;
    const elapsedMs = Math.max(0, now - turnStartedAt);
    const timeField = sideToMove === 'w' ? 'white_time_ms' : 'black_time_ms';
    const remainingMs = (game[timeField] ?? 0) - elapsedMs;

    if (remainingMs > 0) {
      return Response.json({ game });
    }

    const timeoutUpdates = {
      status: 'completed',
      result: sideToMove === 'w' ? 'black_win' : 'white_win',
      winner_id: sideToMove === 'w' ? match.player2_id : match.player1_id,
      end_reason: 'timeout',
      completed_at: new Date().toISOString(),
      [timeField]: 0,
    };
    const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, timeoutUpdates);
    return Response.json({ game: updatedGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});