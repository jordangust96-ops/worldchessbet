import React, { useState, useEffect, useMemo } from "react";
import { Chess } from "chess.js";
import { Trophy, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

// Derives a human-readable end reason from the final position. Timeout can't be
// detected from the FEN/PGN alone, so any non-terminal position is classified as
// a timeout — the backend already guarantees status is only "completed" for a
// real game-ending condition (checkmate, draw rule, or a clock expiring).
function getEndReason(game) {
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

export default function GameSummary({ match, game, userId, onPlayAgain }) {
  const [opponentName, setOpponentName] = useState("Opponent");

  const isP1 = match.player1_id === userId;
  const opponentId = isP1 ? match.player2_id : match.player1_id;
  const won = game?.winner_id === userId;
  const draw = game?.result === "draw";

  useEffect(() => {
    const load = async () => {
      if (!opponentId) return;
      const users = await base44.entities.User.filter({ id: opponentId });
      if (users[0]) {
        setOpponentName(users[0].chess_com_username || users[0].full_name?.split(" ")[0] || "Opponent");
      }
    };
    load();
  }, [opponentId]);

  const endReason = useMemo(() => getEndReason(game), [game]);

  return (
    <div className="space-y-5 lg:space-y-3 text-center py-4">
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
          draw ? "bg-white/10" : won ? "gold-gradient" : "bg-red-500/10"
        }`}
      >
        {draw ? (
          <Minus size={26} className="text-white/50" />
        ) : won ? (
          <Trophy size={26} className="text-black" />
        ) : (
          <X size={26} className="text-red-400" />
        )}
      </div>

      <div>
        <p className={`text-2xl font-extrabold ${draw ? "text-white/50" : won ? "text-[#C9A84C]" : "text-red-400"}`}>
          {draw ? "Draw" : won ? "Victory" : "Defeat"}
        </p>
        <p className="text-white/40 text-sm mt-1">{endReason}</p>
      </div>

      <div className="rounded-2xl bg-white/[0.03] p-3.5 space-y-2 text-left">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Opponent</span>
          <span className="text-xs font-semibold text-white/80">{opponentName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Time Control</span>
          <span className="text-xs font-semibold text-white/80">{match.display_name}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Wager</span>
          <span className="text-xs font-semibold text-white/80">${match.wager_amount.toFixed(2)}</span>
        </div>
      </div>

      <div
        className={`rounded-2xl p-4 border ${
          draw
            ? "bg-white/[0.03] border-white/10"
            : won
            ? "bg-[#C9A84C]/5 border-[#C9A84C]/20"
            : "bg-red-500/5 border-red-500/20"
        }`}
      >
        <p
          className={`text-[10px] uppercase tracking-widest mb-1 ${
            draw ? "text-white/40" : won ? "text-[#C9A84C]/60" : "text-red-400/60"
          }`}
        >
          {draw ? "Result" : won ? "You Won" : "You Lost"}
        </p>
        <p
          className={`text-3xl font-extrabold ${
            draw ? "text-white/60" : won ? "text-[#C9A84C]" : "text-red-400"
          }`}
        >
          {draw ? "$0.00" : `${won ? "+" : "-"}$${match.wager_amount.toFixed(2)}`}
        </p>
      </div>

      <p className="text-xs text-white/30">Settlement Pending</p>

      <div className="space-y-2">
        <Button onClick={onPlayAgain} className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90">
          Play Again
        </Button>
        <Button disabled variant="outline" className="w-full h-11 rounded-2xl font-semibold border-white/10 text-white/30">
          View Game
        </Button>
      </div>
    </div>
  );
}