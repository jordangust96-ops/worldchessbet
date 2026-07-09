import React from "react";
import { Check, Loader2 } from "lucide-react";

export default function DepositWaitingState({ match }) {
  return (
    <div className="space-y-5 lg:space-y-3 text-center py-4">
      <p className="text-[10px] uppercase tracking-widest text-white/30">Deposit Complete</p>
      <div className="w-14 h-14 rounded-2xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center mx-auto">
        <Check size={24} className="text-[#C9A84C]" />
      </div>
      <div>
        <p className="text-base font-bold text-white">Your deposit received</p>
        <p className="text-sm text-white/40 mt-1">Waiting for opponent...</p>
      </div>
      <div className="flex items-center justify-center gap-2 text-white/40">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-sm">Opponent status: Waiting</span>
      </div>
      <p className="text-xs text-white/20">${match.wager_amount.toFixed(2)} secured in escrow</p>
    </div>
  );
}