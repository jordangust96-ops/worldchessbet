import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ExternalLink, Shield, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function ActiveMatch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [user, setUser] = useState(null);
  const [gameUrl, setGameUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      setUser(me);
      const m = await base44.entities.Match.get(id);
      setMatch(m);
      if (m.chess_com_game_url) setGameUrl(m.chess_com_game_url);
    };
    load();
  }, [id]);

  // Poll for completion
  useEffect(() => {
    if (!match) return;
    const poll = setInterval(async () => {
      const m = await base44.entities.Match.get(id);
      setMatch(m);
      if (m.status === "completed") {
        clearInterval(poll);
        navigate(`/results/${id}`);
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [match?.id]);

  const handleSubmitResult = async (result) => {
    if (!match || !user) return;
    setSubmitting(true);
    const isP1 = match.player1_id === user.id;
    const winnerId =
      result === "win"
        ? user.id
        : result === "loss"
        ? isP1
          ? match.player2_id
          : match.player1_id
        : null;

    await base44.entities.Match.update(id, {
      status: "completed",
      result:
        result === "draw"
          ? "draw"
          : result === "win"
          ? isP1
            ? "player1_win"
            : "player2_win"
          : isP1
          ? "player2_win"
          : "player1_win",
      winner_id: winnerId,
      chess_com_game_url: gameUrl || undefined,
      completed_at: new Date().toISOString(),
    });

    // Handle payouts
    if (result === "draw") {
      // Refund both players
      const p1Wallets = await base44.entities.Wallet.filter({ user_id: match.player1_id });
      const p2Wallets = await base44.entities.Wallet.filter({ user_id: match.player2_id });
      if (p1Wallets[0]) {
        await base44.entities.Wallet.update(p1Wallets[0].id, {
          balance: p1Wallets[0].balance + match.wager_amount,
        });
      }
      if (p2Wallets[0]) {
        await base44.entities.Wallet.update(p2Wallets[0].id, {
          balance: p2Wallets[0].balance + match.wager_amount,
        });
      }
    } else {
      // Pay the winner
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
          match_id: id,
          description: `Won $${match.wager_amount} match`,
        });
      }
    }

    navigate(`/results/${id}`);
  };

  if (!match || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 pt-8 pb-32">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-sm mx-auto space-y-6"
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-[#C9A84C]">
            <Clock size={16} />
            <span className="text-xs font-semibold uppercase tracking-widest">Match In Progress</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">${match.wager_amount} Match</h1>
        </div>

        {/* Escrow Info */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
          <div className="flex items-center gap-3">
            <Shield size={18} className="text-[#C9A84C]" />
            <div>
              <p className="text-xs text-white/40">Total Escrow</p>
              <p className="text-xl font-bold text-white">${match.wager_amount * 2}</p>
            </div>
          </div>
        </div>

        {/* Chess.com Link Input */}
        <div className="space-y-3">
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Chess.com Game Link (optional)
          </label>
          <input
            type="url"
            value={gameUrl}
            onChange={(e) => setGameUrl(e.target.value)}
            placeholder="https://chess.com/game/..."
            className="w-full h-12 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none transition-colors"
          />
          {gameUrl && (
            <a
              href={gameUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#C9A84C] text-xs hover:underline"
            >
              <ExternalLink size={12} />
              Open in Chess.com
            </a>
          )}
        </div>

        {/* Submit Results */}
        <div className="space-y-3 pt-4">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider text-center">
            Report Result
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Button
              onClick={() => handleSubmitResult("win")}
              disabled={submitting}
              className="h-14 rounded-2xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 text-[#C9A84C] font-bold hover:bg-[#C9A84C]/20"
            >
              I Won
            </Button>
            <Button
              onClick={() => handleSubmitResult("draw")}
              disabled={submitting}
              variant="outline"
              className="h-14 rounded-2xl border-white/10 text-white/60 font-bold hover:bg-white/5"
            >
              Draw
            </Button>
            <Button
              onClick={() => handleSubmitResult("loss")}
              disabled={submitting}
              className="h-14 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold hover:bg-red-500/20"
            >
              I Lost
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}