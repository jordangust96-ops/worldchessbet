import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Chess } from 'npm:chess.js@1.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { gameId, from, to, promotion } = await req.json();
    if (!gameId || !from || !to) {
      return Response.json({ error: 'gameId, from, and to are required' }, { status: 400 });
    }

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

    const chess = new Chess();
    chess.load(game.fen);

    const myColor = isP1 ? 'w' : 'b';
    if (chess.turn() !== myColor) {
      return Response.json({ error: 'Not your turn' }, { status: 400 });
    }

    // Server-authoritative clock: deduct time elapsed since this player's clock started.
    const now = Date.now();
    const turnStartedAt = game.turn_started_at ? new Date(game.turn_started_at).getTime() : now;
    const elapsedMs = Math.max(0, now - turnStartedAt);
    const moverTimeField = myColor === 'w' ? 'white_time_ms' : 'black_time_ms';
    const moverRemainingMs = (game[moverTimeField] ?? 0) - elapsedMs;

    if (moverRemainingMs <= 0) {
      const timeoutUpdates = {
        status: 'completed',
        result: myColor === 'w' ? 'black_win' : 'white_win',
        winner_id: myColor === 'w' ? match.player2_id : match.player1_id,
        end_reason: 'timeout',
        completed_at: new Date().toISOString(),
        [moverTimeField]: 0,
      };
      const timedOutGame = await base44.asServiceRole.entities.Game.update(gameId, timeoutUpdates);
      return Response.json({ game: timedOutGame });
    }

    let move;
    try {
      move = chess.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      move = null;
    }

    if (!move) {
      return Response.json({ error: 'Illegal move' }, { status: 400 });
    }

    const updates = {
      fen: chess.fen(),
      pgn: chess.pgn(),
      [moverTimeField]: moverRemainingMs,
      turn_started_at: new Date().toISOString(),
    };
    if (!game.started_at) {
      updates.started_at = new Date().toISOString();
    }

    if (chess.isGameOver()) {
      updates.status = 'completed';
      updates.completed_at = new Date().toISOString();
      if (chess.isCheckmate()) {
        updates.result = move.color === 'w' ? 'white_win' : 'black_win';
        updates.winner_id = move.color === 'w' ? match.player1_id : match.player2_id;
        updates.end_reason = 'checkmate';
      } else {
        updates.result = 'draw';
        if (chess.isStalemate()) updates.end_reason = 'stalemate';
        else if (chess.isThreefoldRepetition()) updates.end_reason = 'threefold_repetition';
        else if (chess.isInsufficientMaterial()) updates.end_reason = 'insufficient_material';
        else updates.end_reason = 'fifty_move_rule';
      }
    }

    const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, updates);

    return Response.json({ game: updatedGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});