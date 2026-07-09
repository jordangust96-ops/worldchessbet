import React from "react";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BothReadyState({ match, onLaunch }) {
  return (
    <div className="space-y-5 lg:space-y-3 text-center py-4">
      <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]/70">Both Players Ready</p>
      <div className="w-14 h-14 rounded-2xl gold-gradient flex items-center justify-center mx-auto">
        <Shield size={24} className="text-black" />
      </div>
      <div>
        <p className="text-base font-bold text-white">Both deposits secured</p>
        <p className="text-sm text-white/40 mt-1">Escrow locked · ${(match.wager_amount * 2).toFixed(2)} total</p>
      </div>
      <Button
        onClick={onLaunch}
        className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90"
      >
        Launch Match
      </Button>
    </div>
  );
}