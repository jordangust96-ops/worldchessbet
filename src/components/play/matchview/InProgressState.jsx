import React, { useState } from "react";
import { ExternalLink, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function InProgressState({ match, userId, onSubmitted }) {
  const [gameUrl, setGameUrl] = useState(match.chess_com_game_url || "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitResult = async (result) => {
    setSubmitting(true);
    const isP1 = match.player1_id === userId;
    const winnerId =
      result === "win" ? userId : result === "loss" ? (isP1 ? match.player2_id : match.player1_id) : null;

    await base44.entities.Match.update(match.id, {
      status: "completed",
      result:
        result === "draw" ? "draw" : result === "win" ? (isP1 ? "player1_win" : "player2_win") : (isP1 ? "player2_win" : "player1_win"),
      winner_id: winnerId,
      chess_com_game_url: gameUrl || undefined,
      completed_at: new Date().toISOString(),
    });

    if (result === "draw") {
      const p1Wallets = await base44.entities.Wallet.filter({ user_id: match.player1_id });
      const p2Wallets = await base44.entities.Wallet.filter({ user_id: match.player2_id });
      if (p1Wallets[0]) {
        await base44.entities.Wallet.update(p1Wallets[0].id, { balance: p1Wallets[0].balance + match.wager_amount });
      }
      if (p2Wallets[0]) {
        await base44.entities.Wallet.update(p2Wallets[0].id, { balance: p2Wallets[0].balance + match.wager_amount });
      }
    } else {
      const winnerWallets = await base44.entities.Wallet.filter({ user_id: winnerId });
      if (winnerWallets[0]) {
        const pot = match.wager_amount * 2;
        await base44.entities.Wallet.update(winnerWallets[0].id, {
          balance: winnerWallets[0].balance + pot,
          total_won: (winnerWallets[0].total_won || 0) + pot,
        });
        await base44.entities.WalletTransaction.create({
          user_id: winnerId,
          type: "payout",
          amount: pot,
          match_id: match.id,
          description: `Won $${match.wager_amount} match`,
        });
      }
    }
    setSubmitting(false);
    onSubmitted();
  };

  return (
    <div className="space-y-5 lg:space-y-3">
      <div className="flex items-center gap-2 text-[#C9A84C]">
        <Clock size={16} />
        <p className="text-[10px] font-bold uppercase tracking-widest">Match In Progress</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Chess.com Game Link</label>
        <input
          type="url"
          value={gameUrl}
          onChange={(e) => setGameUrl(e.target.value)}
          placeholder="https://chess.com/game/..."
          className="w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none"
        />
        {gameUrl && (
          <a
            href={gameUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[#C9A84C] text-xs hover:underline"
          >
            <ExternalLink size={12} /> Open Chess.com
          </a>
        )}
      </div>

      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider text-center">Report Result</p>
        <div className="grid grid-cols-3 gap-2">
          <Button
            onClick={() => handleSubmitResult("win")}
            disabled={submitting}
            className="h-12 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 text-[#C9A84C] font-bold hover:bg-[#C9A84C]/20 text-xs"
          >
            I Won
          </Button>
          <Button
            onClick={() => handleSubmitResult("draw")}
            disabled={submitting}
            variant="outline"
            className="h-12 rounded-xl border-white/10 text-white/60 font-bold hover:bg-white/5 text-xs"
          >
            Draw
          </Button>
          <Button
            onClick={() => handleSubmitResult("loss")}
            disabled={submitting}
            className="h-12 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold hover:bg-red-500/20 text-xs"
          >
            I Lost
          </Button>
        </div>
      </div>
    </div>
  );
}