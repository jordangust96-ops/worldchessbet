import { Chess } from "chess.js";

// Derives a human-readable end reason from the final position. Timeout can't be
// detected from the FEN/PGN alone, so any non-terminal position is classified as
// a timeout — the backend already guarantees status is only "completed" for a
// real game-ending condition (checkmate, draw rule, or a clock expiring).
export function getEndReason(game) {
  if (!game?.fen) return "Game Over";
  try {
    const chess = new Chess();
    if (game.pgn) chess.loadPgn(game.pgn);
    else chess.load(game.fen);

    if (chess.isCheckmate()) return "Checkmate";
    if (chess.isStalemate()) return "Stalemate";
    if (chess.isThreefoldRepetition()) return "Threefold Repetition";
    if (chess.isInsufficientMaterial()) return "Insufficient Material";
    if (chess.isDraw()) return "Fifty-Move Rule";
    return "Timeout";
  } catch (e) {
    return "Game Over";
  }
}