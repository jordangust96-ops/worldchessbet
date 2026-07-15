import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Chess } from 'npm:chess.js@1.0.0';

// Authoritative determination of whether a color has sufficient material to
// ever deliver checkmate, used exclusively for timeout resolution (FIDE
// Article 6.9). Mirrors the standard thresholds used by chess engines (bare
// king, king+single minor piece = insufficient; anything else = sufficient).
// Duplicated (not imported) in checkTimeout — backend functions deploy
// independently and cannot share local modules. There is one authoritative
// set of thresholds; keep both copies identical.
function hasSufficientMatingMaterial(fen, color) {
  const boardPart = fen.split(' ')[0];
  let pawns = 0, knights = 0, bishops = 0, rooks = 0, queens = 0;
  for (const ch of boardPart) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const pieceColor = ch === ch.toUpperCase() ? 'w' : 'b';
    if (pieceColor !== color) continue;
    switch (ch.toLowerCase()) {
      case 'p': pawns++; break;
      case 'n': knights++; break;
      case 'b': bishops++; break;
      case 'r': rooks++; break;
      case 'q': queens++; break;
    }
  }
  if (pawns > 0 || rooks > 0 || queens > 0) return true;
  return knights + bishops >= 2;
}

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
      // FIDE Article 6.9: the flagged player only loses if the opponent has
      // sufficient material to deliver checkmate by some legal sequence.
      const opponentColor = myColor === 'w' ? 'b' : 'w';
      const opponentCanMate = hasSufficientMatingMaterial(game.fen, opponentColor);

      const timeoutUpdates = opponentCanMate
        ? {
            status: 'completed',
            result: myColor === 'w' ? 'black_win' : 'white_win',
            winner_id: myColor === 'w' ? match.player2_id : match.player1_id,
            end_reason: 'timeout',
            completed_at: new Date().toISOString(),
            [moverTimeField]: 0,
          }
        : {
            status: 'completed',
            result: 'draw',
            winner_id: '',
            end_reason: 'timeout_vs_insufficient_material',
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

    const moveTimestamp = new Date().toISOString();
    const updates = {
      fen: chess.fen(),
      pgn: chess.pgn(),
      [moverTimeField]: moverRemainingMs,
      turn_started_at: moveTimestamp,
      move_log: [
        ...(game.move_log || []),
        {
          ply: (game.move_log || []).length + 1,
          color: move.color,
          san: move.san,
          fen_after: chess.fen(),
          timestamp: moveTimestamp,
          remaining_ms: moverRemainingMs,
        },
      ],
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