import React from "react";
import { Loader2 } from "lucide-react";

// Brief transitional state shown only between the chess game ending
// (game.status === "completed") and the Match's own settlement finishing
// (match.status === "completed") — never a second victory/defeat screen,
// just a lightweight "please wait" so only one post-match result card
// (SettlementState) is ever shown to the user.
export default function FinalizingMatch() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <Loader2 className="animate-spin text-[#C9A84C]" size={24} />
      <p className="text-xs text-white/40">Finalizing match result...</p>
    </div>
  );
}