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
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-4 lg:mb-1.5">Your Active Challenge</p>
      <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 lg:p-3 min-h-[168px] lg:min-h-[110px] flex flex-col justify-center">
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
            className="space-y-2 lg:space-y-1.5">
            
              <div className="flex items-center justify-between">
                <p className="text-sm text-white/50">Waiting for an opponent...</p>
                <button
                onClick={() => setShowConfirm(true)}
                disabled={cancelling}
                className="text-xs font-semibold text-white/40 hover:text-white/70 transition-colors underline underline-offset-2">
                
                  {cancelling ? <Loader2 size={14} className="animate-spin" /> : "Cancel Challenge"}
                </button>
              </div>
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