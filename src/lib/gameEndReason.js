import { Chess } from "chess.js";

const END_REASON_LABELS = {
  checkmate: "Checkmate",
  resignation: "Resignation",
  timeout: "Timeout",
  draw_agreement: "Draw by Agreement",
  stalemate: "Stalemate",
  threefold_repetition: "Threefold Repetition",
  insufficient_material: "Insufficient Material",
  fifty_move_rule: "Fifty-Move Rule",
  timeout_vs_insufficient_material: "Timeout vs. Insufficient Material",
};

// Prefers the authoritative end_reason set server-side by whichever function
// completed the game. Only falls back to guessing from the final position for
// older records created before end_reason existed.
export function getEndReason(game) {
  if (game?.end_reason && END_REASON_LABELS[game.end_reason]) {
    return END_REASON_LABELS[game.end_reason];
  }
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