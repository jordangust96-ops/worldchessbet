import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy, Minus, X, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function Results() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      setUser(me);
      const m = await base44.entities.Match.get(id);
      setMatch(m);
    };
    load();
  }, [id]);

  if (!match || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  const won = match.winner_id === user.id;
  const draw = match.result === "draw";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="max-w-sm w-full text-center space-y-8"
      >
        {/* Result Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 300 }}
          className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto ${
            draw
              ? "bg-white/10"
              : won
              ? "gold-gradient"
              : "bg-red-500/10"
          }`}
        >
          {draw ? (
            <Minus size={36} className="text-white/50" />
          ) : won ? (
            <Trophy size={36} className="text-black" />
          ) : (
            <X size={36} className="text-red-400" />
          )}
        </motion.div>

        {/* Result Text */}
        <div className="space-y-2">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className={`text-4xl font-extrabold ${
              draw ? "text-white/50" : won ? "text-[#C9A84C]" : "text-red-400"
            }`}
          >
            {draw ? "Draw" : won ? "Victory!" : "Defeat"}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-white/40 text-sm"
          >
            {draw
              ? "Wagers have been refunded"
              : won
              ? `You won $${match.wager_amount * 2}`
              : `You lost $${match.wager_amount}`}
          </motion.p>
        </div>

        {/* Payout Card */}
        {!draw && won && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-6"
          >
            <p className="text-xs text-[#C9A84C]/60 uppercase tracking-widest mb-1">Payout</p>
            <p className="text-3xl font-extrabold text-[#C9A84C]">+${match.wager_amount * 2}</p>
          </motion.div>
        )}

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="space-y-3 pt-4"
        >
          <Button
            onClick={() => navigate("/")}
            className="w-full h-14 rounded-2xl text-base font-bold gold-gradient text-black hover:opacity-90"
          >
            Play Again <ArrowRight size={18} className="ml-2" />
          </Button>
          <Button
            onClick={() => navigate("/wallet")}
            variant="ghost"
            className="w-full text-white/40 hover:text-white/60"
          >
            View Wallet
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}