import React, { useState, useEffect, useMemo } from "react";
import { Chess } from "chess.js";
import { Trophy, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import ShareOnXButton from "./ShareOnXButton";

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
  const [winnerName, setWinnerName] = useState("You");

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

  useEffect(() => {
    const load = async () => {
      if (!userId) return;
      const users = await base44.entities.User.filter({ id: userId });
      if (users[0]) {
        setWinnerName(users[0].chess_com_username || users[0].full_name?.split(" ")[0] || "You");
      }
    };
    load();
  }, [userId]);

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
        className={`rounded-2xl p-4 border space-y-2 ${
          draw
            ? "bg-white/[0.03] border-white/10"
            : won
            ? "bg-[#C9A84C]/5 border-[#C9A84C]/20"
            : "bg-red-500/5 border-red-500/20"
        }`}
      >
        {draw ? (
          <>
            <p className="text-[10px] uppercase tracking-widest mb-1 text-white/40">Result</p>
            <p className="text-3xl font-extrabold text-white/60">$0.00</p>
          </>
        ) : won ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Prize Pool</span>
              <span className="font-semibold text-white/80">${(match.wager_amount * 2).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Platform Fee (10%)</span>
              <span className="font-semibold text-white/50">-${(match.wager_amount * 2 * 0.1).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-xs uppercase tracking-widest text-[#C9A84C]/60">You Receive</span>
              <span className="text-3xl font-extrabold text-[#C9A84C]">
                +${(match.wager_amount * 2 * 0.9).toFixed(2)}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Your Wager</span>
              <span className="font-semibold text-red-400">-${match.wager_amount.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Platform Fee</span>
              <span className="font-semibold text-white/50">Included in winner payout</span>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-white/30">
        {draw
          ? "Both players receive the appropriate settlement according to ChessBet's draw rules."
          : won
          ? "You won your match and received 90% of the total prize pool after the ChessBet platform fee."
          : "Your wager was forfeited as part of the completed match."}
      </p>

      <p className="text-xs text-white/20">Finalizing Match...</p>

      <div className="space-y-2">
        <Button onClick={onPlayAgain} className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90">
          Find New Match
        </Button>
        {won && (
          <ShareOnXButton match={match} game={game} winnerName={winnerName} opponentName={opponentName} endReason={endReason} />
        )}
      </div>
    </div>
  );
}