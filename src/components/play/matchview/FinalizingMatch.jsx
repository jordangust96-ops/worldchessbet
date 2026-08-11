import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Brief transitional state shown only between the chess game ending
// (game.status === "completed") and the Match's own settlement finishing
// (match.status === "completed") — never a second victory/defeat screen,
// just a lightweight "please wait" so only one post-match result card
// (SettlementState) is ever shown to the user.
export default function FinalizingMatch() {
  const [takingLonger, setTakingLonger] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setTakingLonger(true), 10_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 className="animate-spin text-[#C9A84C]" size={24} />
      <p className="text-xs text-white/50">
        {takingLonger ? "Settlement is continuing securely..." : "Finalizing match result..."}
      </p>
      {takingLonger && (
        <p className="max-w-xs text-[11px] leading-relaxed text-white/30">
          Automatic recovery is active. The result and reserved funds are processed on ChessBet&apos;s servers, so you
          may refresh, close this page, or return later without affecting settlement.
        </p>
      )}
    </div>
  );
}