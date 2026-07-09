import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2, Swords } from "lucide-react";
import { base44 } from "@/api/base44Client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle } from
"@/components/ui/alert-dialog";

function formatElapsed(startDate) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startDate).getTime()) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function ActiveChallengeCard({ match, onCancel }) {
  const [elapsed, setElapsed] = useState(match ? formatElapsed(match.created_date) : "00:00");
  const [opponentName, setOpponentName] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!match) return;
    const tick = setInterval(() => setElapsed(formatElapsed(match.created_date)), 1000);
    return () => clearInterval(tick);
  }, [match?.created_date]);

  useEffect(() => {
    if (!match || match.status !== "matched" || !match.player2_id) {
      setOpponentName("");
      return;
    }
    const load = async () => {
      const users = await base44.entities.User.filter({ id: match.player2_id });
      const opponent = users?.[0];
      setOpponentName(opponent?.chess_com_username || opponent?.full_name?.split(" ")[0] || "Opponent");
    };
    load();
  }, [match?.status, match?.player2_id]);

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
    setShowConfirm(false);
  };

  return (
    <div>
      <div className="rounded-2xl bg-[#141210] border border-[#C9A84C]/30 shadow-[0_0_24px_rgba(201,168,76,0.08)] p-5 lg:p-4 min-h-[110px] lg:min-h-[90px] flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {!match &&
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center space-y-1 lg:space-y-0.5 py-2 lg:py-0">
            
              <Swords size={18} className="text-white/20 mx-auto lg:hidden" />
              <p className="text-sm font-semibold text-white/50">No Active Challenge</p>
              <p className="text-xs text-white/30">You don't currently have a challenge posted.</p>
            </motion.div>
          }

          {match && match.status === "matched" &&
          <motion.div
            key="matched"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-2 lg:space-y-1.5">
            
              <p className="text-lg lg:text-base font-bold text-white mb-1">Your Active Challenge</p>
              <div className="flex items-center gap-2 text-[#C9A84C]">
                <Sparkles size={16} />
                <p className="text-xs font-bold uppercase tracking-widest">Opponent Found</p>
              </div>
              <div>
                <p className="text-base font-bold text-white">{opponentName || "Opponent"}</p>
                <p className="text-xs text-white/50">
                  ${match.wager_amount.toFixed(2)} · {match.display_name}
                </p>
              </div>
              <p className="text-xs text-white/40 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Entering match...
              </p>
            </motion.div>
          }

          {match && match.status === "searching" &&
          <motion.div
            key="searching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3 lg:space-y-2">
            
              <div className="flex items-center justify-between">
                <p className="text-lg lg:text-base font-bold text-white">Your Active Challenge</p>
                <button
                onClick={() => setShowConfirm(true)}
                disabled={cancelling}
                className="text-sm font-semibold text-[#C9A84C] hover:text-[#E8D48B] transition-colors underline underline-offset-2">
                
                  {cancelling ? <Loader2 size={14} className="animate-spin" /> : "Cancel Challenge"}
                </button>
              </div>
              <div className="flex items-center flex-wrap gap-3 lg:gap-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C9A84C]/40" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#C9A84C]/70" />
                  </span>
                  <p className="text-sm lg:text-xs text-white/70">Waiting for an opponent...</p>
                </div>
                <div className="rounded-full bg-white/[0.06] px-4 py-1.5 lg:px-3 lg:py-1">
                  <span className="text-sm lg:text-xs text-[#C9A84C]/70">Wager: </span>
                  <span className="text-sm lg:text-xs font-bold text-[#C9A84C]">${match.wager_amount.toFixed(2)}</span>
                </div>
                <div className="rounded-full bg-white/[0.06] px-4 py-1.5 lg:px-3 lg:py-1">
                  <span className="text-sm lg:text-xs text-[#C9A84C]/70">Time: </span>
                  <span className="text-sm lg:text-xs font-bold text-white">{match.display_name}</span>
                </div>
              </div>
            </motion.div>
          }
        </AnimatePresence>
      </div>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-[#111] border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Cancel Challenge?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              Your public challenge will be removed from the marketplace and other players will no longer be able to accept it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 text-white/70 hover:bg-white/5 hover:text-white">
              Keep Waiting
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-red-500/90 text-white hover:bg-red-500">
              
              Cancel Challenge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>);

}