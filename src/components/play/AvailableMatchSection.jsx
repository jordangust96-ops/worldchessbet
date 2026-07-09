import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function AvailableMatchSection({ userId, balance, activeMatch, onChallengeCancelled, onAccepted }) {
  const [opponents, setOpponents] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const openMatches = await base44.entities.Match.filter({ status: "searching" }, "-created_date", 20);
      const available = openMatches.filter((m) => m.player1_id !== userId);

      const enriched = await Promise.all(
        available.map(async (m) => {
          let name = "Opponent";
          try {
            const users = await base44.entities.User.filter({ id: m.player1_id });
            const opponent = users?.[0];
            if (opponent?.chess_com_username?.trim()) {
              name = opponent.chess_com_username.trim();
            } else if (opponent?.full_name?.trim()) {
              name = opponent.full_name.trim();
            }
          } catch (e) {
            // fallback to default name
          }
          const played = await base44.entities.Match.filter({ status: "completed" });
          const gamesPlayed = played.filter(
            (pm) => pm.player1_id === m.player1_id || pm.player2_id === m.player1_id
          ).length;
          return { ...m, opponentName: name.trim(), gamesPlayed };
        })
      );

      setOpponents(enriched);
      setLoading(false);
    };
    load();
  }, [userId]);

  const current = opponents[index];
  const insufficientFunds = current ? (balance || 0) < current.wager_amount : false;

  const handleNext = () => {
    if (opponents.length === 0) return;
    setIndex((i) => (i + 1) % opponents.length);
  };

  const handleAccept = async () => {
    if (!current) return;
    setAccepting(true);
    if (activeMatch) {
      await base44.entities.Match.update(activeMatch.id, { status: "cancelled" });
      onChallengeCancelled?.();
    }
    await base44.entities.Match.update(current.id, {
      player2_id: userId,
      status: "matched",
    });
    onAccepted?.(current.id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 lg:h-24">
        <Loader2 className="animate-spin text-[#C9A84C]" size={22} />
      </div>
    );
  }

  if (!current) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2 lg:mb-1.5">Available Match</p>
        <div className="text-center py-6 lg:py-3 px-2 space-y-2 lg:space-y-1">
          <p className="text-white font-bold text-base lg:text-sm">No Matches Available</p>
          <p className="text-white/40 text-sm lg:text-xs leading-relaxed max-w-xs mx-auto">
            No one is waiting to play right now. Host your own match below and we'll automatically
            present it to other players.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-4 lg:mb-1.5">Available Match</p>
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="space-y-6 lg:space-y-2"
        >
          <div className="flex items-center gap-3 lg:gap-2">
            <div className="w-11 h-11 lg:w-8 lg:h-8 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
              <User size={18} className="text-white/50 lg:w-4 lg:h-4" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30">Opponent</p>
              <p className="text-lg lg:text-sm font-bold text-white">{current.opponentName}</p>
              <p className="text-xs text-white/30">{current.gamesPlayed} Games Played</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:gap-2">
            <div className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-4 lg:p-2">
              <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]/60 mb-1">Wager</p>
              <p className="text-xl lg:text-base font-bold text-[#C9A84C]">${current.wager_amount.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.03] p-4 lg:p-2">
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Time Control</p>
              <p className="text-base lg:text-sm font-bold text-white">{current.display_name || "Rapid (10+0)"}</p>
            </div>
          </div>

          <div className="space-y-2.5 lg:space-y-1.5">
            <Button
              onClick={handleAccept}
              disabled={accepting || insufficientFunds}
              className="w-full h-14 lg:h-10 rounded-2xl text-base lg:text-sm font-bold gold-gradient text-black hover:opacity-90 transition-opacity disabled:opacity-30"
            >
              {accepting ? <Loader2 className="animate-spin mr-2" size={18} /> : null}
              Accept Match
            </Button>
            {insufficientFunds && (
              <p className="text-[11px] text-center text-[#C9A84C]/70">
                {(balance || 0) <= 0 ? "Fund your wallet to accept matches." : "Insufficient balance for this wager."}{" "}
                <Link to="/wallet" className="underline font-semibold hover:text-[#C9A84C]">
                  Add Funds
                </Link>
              </p>
            )}
            <Button
              onClick={handleNext}
              variant="outline"
              disabled={accepting}
              className="w-full h-12 lg:h-8 rounded-2xl border-white/10 text-white/60 font-semibold hover:bg-white/5"
            >
              Next Match
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}