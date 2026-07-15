import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Authoritative determination of whether a color has sufficient material to
// ever deliver checkmate, used exclusively for timeout resolution (FIDE
// Article 6.9). Mirrors the standard thresholds used by chess engines (bare
// king, king+single minor piece = insufficient; anything else = sufficient).
// Duplicated (not imported) in submitMove — backend functions deploy
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

    // FIDE Article 6.9: the flagged player only loses if the opponent has
    // sufficient material to deliver checkmate by some legal sequence.
    const opponentColor = sideToMove === 'w' ? 'b' : 'w';
    const opponentCanMate = hasSufficientMatingMaterial(game.fen, opponentColor);

    const timeoutUpdates = opponentCanMate
      ? {
          status: 'completed',
          result: sideToMove === 'w' ? 'black_win' : 'white_win',
          winner_id: sideToMove === 'w' ? match.player2_id : match.player1_id,
          end_reason: 'timeout',
          completed_at: new Date().toISOString(),
          [timeField]: 0,
        }
      : {
          status: 'completed',
          result: 'draw',
          winner_id: '',
          end_reason: 'timeout_vs_insufficient_material',
          completed_at: new Date().toISOString(),
          [timeField]: 0,
        };
    const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, timeoutUpdates);
    return Response.json({ game: updatedGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});