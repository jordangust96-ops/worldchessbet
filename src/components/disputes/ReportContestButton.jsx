import React, { useState } from "react";
import { Flag } from "lucide-react";
import ReportContestModal from "@/components/disputes/ReportContestModal";

// Small, unobtrusive entry point used from the Active Match HUD, Game
// Summary, and Settlement screens.
export default function ReportContestButton({ matchId, gameId, className = "" }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors ${className}`}
      >
        <Flag size={12} />
        Report Contest
      </button>
      <ReportContestModal open={open} onOpenChange={setOpen} matchId={matchId} gameId={gameId} />
    </>
  );
}