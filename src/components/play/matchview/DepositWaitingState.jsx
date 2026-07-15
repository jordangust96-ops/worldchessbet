import React, { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function DepositWaitingState({ match, onCancel }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleConfirmCancel = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
    setShowConfirm(false);
  };

  return (
    <div className="space-y-5 lg:space-y-3 text-center py-4">
      <p className="text-[10px] uppercase tracking-widest text-white/30">Funding Complete</p>
      <div className="w-14 h-14 rounded-2xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center mx-auto">
        <Check size={24} className="text-[#C9A84C]" />
      </div>
      <div>
        <p className="text-base font-bold text-white">Your funds received</p>
        <p className="text-sm text-white/40 mt-1">Waiting for opponent...</p>
      </div>
      <div className="flex items-center justify-center gap-2 text-white/40">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-sm">Opponent status: Waiting</span>
      </div>
      <p className="text-xs text-white/20">${match.wager_amount.toFixed(2)} reserved for this contest</p>

      <Button
        onClick={() => setShowConfirm(true)}
        disabled={cancelling}
        variant="outline"
        className="w-full h-11 rounded-2xl border-white/10 text-white/60 font-semibold hover:bg-white/5"
      >
        Cancel Match
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-[#111] border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Cancel Match?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              Your pending match will be cancelled. Your reserved funds will be released and returned to your Wallet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 text-white/70 hover:bg-white/5 hover:text-white">
              Keep Waiting
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-red-500/90 text-white hover:bg-red-500"
            >
              {cancelling ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              Cancel Match
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}