import React from "react";
import { Info } from "lucide-react";
import { DEMO_MODE } from "@/lib/appConfig";

export default function DemoModeNotice() {
  if (!DEMO_MODE) return null;

  return (
    <p className="flex items-center gap-1 text-[10px] text-white/35 mb-4">
      <Info size={10} strokeWidth={2} className="shrink-0 text-[#C9A84C]/50" />
      Early Access: ChessBet is currently operating in demo mode. Real-money deposits,
      withdrawals, and wager settlements are not yet active.
    </p>
  );
}