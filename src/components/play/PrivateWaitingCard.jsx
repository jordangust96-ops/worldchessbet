import React, { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check, Share2, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import NotifyOnAcceptToggle from "@/components/play/NotifyOnAcceptToggle";
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

// Shown to the host of a Private Match while it's still status="searching" —
// mirrors ActiveChallengeCard's "searching" state but for an invite-link flow
// instead of the public marketplace.
export default function PrivateWaitingCard({ match, onCancel }) {
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const inviteLink = `${window.location.origin}/join/${match.invite_code}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "ChessBet Private Match",
          text: "Join my private ChessBet match!",
          url: inviteLink,
        });
      } catch (e) {
        // User dismissed the native share sheet — nothing to do.
      }
    } else {
      handleCopy();
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
    setShowConfirm(false);
  };

  return (
    <div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl bg-[#141210] border border-[#C9A84C]/30 shadow-[0_0_24px_rgba(201,168,76,0.08)] p-5 lg:p-4 space-y-3 lg:space-y-2"
      >
        <div className="flex items-center gap-2 text-[#C9A84C]">
          <Users size={16} />
          <p className="text-xs font-bold uppercase tracking-widest">Private Match Created</p>
        </div>
        <p className="text-sm text-white/50">Waiting for your friend to join...</p>

        <div className="flex items-center flex-wrap gap-2">
          <div className="rounded-full bg-white/[0.06] px-4 py-1.5">
            <span className="text-xs text-[#C9A84C]/70">Wager: </span>
            <span className="text-xs font-bold text-[#C9A84C]">${match.wager_amount.toFixed(2)}</span>
          </div>
          <div className="rounded-full bg-white/[0.06] px-4 py-1.5">
            <span className="text-xs text-[#C9A84C]/70">Time: </span>
            <span className="text-xs font-bold text-white">{match.display_name}</span>
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 truncate text-xs text-white/40">
          {inviteLink}
        </div>

        <NotifyOnAcceptToggle match={match} />

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={handleCopy}
            variant="outline"
            className="h-10 rounded-xl border-white/10 text-white/70 font-semibold hover:bg-white/5 text-xs"
          >
            {copied ? <Check size={14} className="mr-1.5" /> : <Copy size={14} className="mr-1.5" />}
            {copied ? "Copied" : "Copy Invite Link"}
          </Button>
          <Button
            onClick={handleShare}
            className="h-10 rounded-xl gold-gradient text-black font-semibold text-xs hover:opacity-90"
          >
            <Share2 size={14} className="mr-1.5" />
            Share Invite Link
          </Button>
        </div>

        <button
          onClick={() => setShowConfirm(true)}
          disabled={cancelling}
          className="w-full text-center text-sm font-semibold text-white/40 hover:text-red-400 transition-colors underline underline-offset-2 pt-1"
        >
          {cancelling ? <Loader2 size={14} className="animate-spin inline" /> : "Cancel Match"}
        </button>
      </motion.div>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-[#111] border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Cancel Private Match?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              Your invitation link will be invalidated and your friend will no longer be able to join.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 text-white/70 hover:bg-white/5 hover:text-white">
              Keep Waiting
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-red-500/90 text-white hover:bg-red-500">
              Cancel Match
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}