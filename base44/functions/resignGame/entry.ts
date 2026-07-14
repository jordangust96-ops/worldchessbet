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
      return Response.json({ error: 'Game has already ended' }, { status: 400 });
    }

    const match = await base44.asServiceRole.entities.Match.get(game.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    const winnerId = isP1 ? match.player2_id : match.player1_id;
    const result = isP1 ? 'black_win' : 'white_win';

    const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, {
      status: 'completed',
      result,
      winner_id: winnerId,
      end_reason: 'resignation',
      completed_at: new Date().toISOString(),
      draw_offered_by: '',
    });

    return Response.json({ game: updatedGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});