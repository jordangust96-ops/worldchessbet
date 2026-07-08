import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { X, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

function formatElapsed(startDate) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startDate).getTime()) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function ActiveChallengeCard({ match, onCancel }) {
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(formatElapsed(match.created_date));
  const [opponentName, setOpponentName] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setElapsed(formatElapsed(match.created_date)), 1000);
    return () => clearInterval(tick);
  }, [match.created_date]);

  useEffect(() => {
    if (match.status !== "matched" || !match.player2_id) return;
    const load = async () => {
      const users = await base44.entities.User.filter({ id: match.player2_id });
      const opponent = users?.[0];
      setOpponentName(opponent?.chess_com_username || opponent?.full_name?.split(" ")[0] || "Opponent");
    };
    load();
  }, [match.status, match.player2_id]);

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
  };

  if (match.status === "matched") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl bg-gradient-to-br from-[#C9A84C]/20 to-[#C9A84C]/5 border border-[#C9A84C]/40 p-5 space-y-3"
      >
        <div className="flex items-center gap-2 text-[#C9A84C]">
          <Sparkles size={16} />
          <p className="text-xs font-bold uppercase tracking-widest">Opponent Found</p>
        </div>
        <div>
          <p className="text-lg font-bold text-white">{opponentName || "Opponent"}</p>
          <p className="text-sm text-white/50">
            ${match.wager_amount.toFixed(2)} · {match.display_name}
          </p>
        </div>
        <Button
          onClick={() => navigate(`/match/${match.id}`)}
          className="w-full h-12 rounded-xl font-bold gold-gradient text-black hover:opacity-90"
        >
          Join Match
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-white/50">Your Active Challenge</p>
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="text-white/30 hover:text-white/60 transition-colors"
        >
          {cancelling ? <Loader2 size={14} className="animate-spin" /> : <X size={16} />}
        </button>
      </div>
      <p className="text-sm text-white/50">Waiting for an opponent...</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/30">Wager</p>
          <p className="text-sm font-bold text-[#C9A84C]">${match.wager_amount.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/30">Time</p>
          <p className="text-sm font-bold text-white">{match.display_name}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/30">Elapsed</p>
          <p className="text-sm font-bold text-white flex items-center justify-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {elapsed}
          </p>
        </div>
      </div>
    </motion.div>
  );
}