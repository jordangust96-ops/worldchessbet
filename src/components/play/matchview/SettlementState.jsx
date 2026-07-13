import React, { useState, useEffect, useMemo } from "react";
import { Trophy, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { getEndReason } from "@/lib/gameEndReason";
import ShareOnXButton from "./ShareOnXButton";

export default function SettlementState({ match, game, userId, onReturn }) {
  const [opponentName, setOpponentName] = useState("Opponent");
  const [winnerName, setWinnerName] = useState("You");

  const won = match.winner_id === userId;
  const draw = match.result === "draw";
  const isP1 = match.player1_id === userId;
  const opponentId = isP1 ? match.player2_id : match.player1_id;

  useEffect(() => {
    const load = async () => {
      const ids = [userId, opponentId].filter(Boolean);
      if (ids.length === 0) return;
      const { data } = await base44.functions.invoke("getUserDisplayNames", { userIds: ids });
      if (opponentId) setOpponentName(data?.names?.[opponentId] || "Opponent");
      if (userId) setWinnerName(data?.names?.[userId] || "You");
    };
    load();
  }, [userId, opponentId]);

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
          {draw ? "Draw" : won ? "Victory!" : "Defeat"}
        </p>
        <p className="text-white/40 text-sm mt-1">
          {draw
            ? "Wagers have been refunded"
            : won
            ? `You won $${(match.wager_amount * 2).toFixed(2)}`
            : `You lost $${match.wager_amount.toFixed(2)}`}
        </p>
      </div>
      {!draw && won && (
        <div className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-4">
          <p className="text-[10px] text-[#C9A84C]/60 uppercase tracking-widest mb-1">Prize</p>
          <p className="text-2xl font-extrabold text-[#C9A84C]">+${(match.wager_amount * 2).toFixed(2)}</p>
        </div>
      )}
      <p className="text-xs text-white/30">Wallet Updated</p>
      <div className="space-y-2">
        <Button onClick={onReturn} className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90">
          Return to Marketplace
        </Button>
        {won && (
          <ShareOnXButton match={match} game={game} winnerName={winnerName} opponentName={opponentName} endReason={endReason} />
        )}
      </div>
    </div>
  );
}