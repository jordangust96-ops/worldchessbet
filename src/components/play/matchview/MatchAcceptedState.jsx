import React, { useState, useEffect } from "react";
import { Shield, Check, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import FairPlayAttestation from "./FairPlayAttestation";

export default function MatchAcceptedState({
  match,
  userId,
  opponentId,
  myDeposited,
  opponentDeposited,
  onDeposited,
  onCancel,
}) {
  const [opponentName, setOpponentName] = useState("Opponent");
  const [depositing, setDepositing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [fairPlayAccepted, setFairPlayAccepted] = useState(false);

  useEffect(() => {
    if (!opponentId) return;
    const load = async () => {
      const { data } = await base44.functions.invoke("getUserDisplayNames", { userIds: [opponentId] });
      setOpponentName(data?.names?.[opponentId] || "Opponent");
    };
    load();
  }, [opponentId]);

  const handleDeposit = async () => {
    setDepositing(true);
    // The wallet deduction and match status update happen server-side
    // (lockWager) — the Wallet entity can no longer be written to directly
    // from the client.
    const { data } = await base44.functions.invoke("lockWager", { matchId: match.id });
    if (data?.match) {
      onDeposited();
    }
    setDepositing(false);
  };

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
  };

  return (
    <div className="space-y-5 lg:space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-white/30">Match Accepted</p>

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
          <User size={18} className="text-white/50" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30">Opponent</p>
          <p className="text-base font-bold text-white">{opponentName}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-4">
          <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]/60 mb-1">Entry Amount</p>
          <p className="text-xl font-bold text-[#C9A84C]">${match.wager_amount.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Time Control</p>
          <p className="text-base font-bold text-white">{match.display_name}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white/[0.03] p-4 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Match Summary</p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Your Entry Amount</span>
          <span className="font-semibold text-white/80">${match.wager_amount.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Opponent Entry Amount</span>
          <span className="font-semibold text-white/80">${match.wager_amount.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Contest Prize</span>
          <span className="font-semibold text-white/80">${(match.wager_amount * 2).toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Platform Service Fee (10%)</span>
          <span className="font-semibold text-white/50">-${(match.wager_amount * 2 * 0.1).toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <span className="text-sm font-semibold text-white/70">Winner Receives</span>
          <span className="text-lg font-extrabold text-[#C9A84C]">${(match.wager_amount * 2 * 0.9).toFixed(2)}</span>
        </div>
        <p className="text-[11px] text-white/30 pt-1">
          ChessBet collects a 10% platform service fee from the total contest prize. The remaining 90% is paid to the winner.
        </p>
      </div>

      <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
        <span className="text-sm text-white/70">Opponent Deposit</span>
        {opponentDeposited ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-[#C9A84C]">
            <Check size={14} /> Deposited
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-white/30">
            <Loader2 size={12} className="animate-spin" /> Waiting
          </span>
        )}
      </div>

      <FairPlayAttestation checked={fairPlayAccepted} onCheckedChange={setFairPlayAccepted} />

      <div className="space-y-2.5">
        <Button
          onClick={handleDeposit}
          disabled={depositing || !fairPlayAccepted}
          className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90"
        >
          {depositing ? <Loader2 className="animate-spin mr-2" size={16} /> : <Shield size={16} className="mr-2" />}
          Fund ${match.wager_amount.toFixed(2)}
        </Button>
        <Button
          onClick={handleCancel}
          disabled={cancelling}
          variant="outline"
          className="w-full h-11 rounded-2xl border-white/10 text-white/60 font-semibold hover:bg-white/5"
        >
          Cancel Match
        </Button>
      </div>
    </div>
  );
}