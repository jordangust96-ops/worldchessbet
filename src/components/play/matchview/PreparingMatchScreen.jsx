import React, { useState, useEffect } from "react";
import { Check, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import FairPlayAttestation from "@/components/play/matchview/FairPlayAttestation";
import { computeContestFinancials } from "@/lib/contestFinancials";

function ReadinessRow({ label, done }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/60">{label}</span>
      {done ? (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-[#C9A84C]">
          <Check size={14} /> Complete
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-white/30">
          <Loader2 size={12} className="animate-spin" /> Pending
        </span>
      )}
    </div>
  );
}

// The single, shared pre-match readiness screen for BOTH players, for both
// public and private matches. Requires identical actions from each side —
// certify Fair Play, then reserve the Entry Amount — before the match can
// ever go live. Progress on both sides updates live via the match prop,
// which is sourced from Home's single authoritative Match subscription.
export default function PreparingMatchScreen({ match, userId, opponentId, onCancel }) {
  const [opponentName, setOpponentName] = useState("Opponent");
  const [agree, setAgree] = useState(false);
  const [certifying, setCertifying] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!opponentId) return;
    base44.functions.invoke("getUserDisplayNames", { userIds: [opponentId] }).then(({ data }) => {
      setOpponentName(data?.names?.[opponentId] || "Opponent");
    });
  }, [opponentId]);

  const financials = computeContestFinancials(match.wager_amount);
  const isP1 = match.player1_id === userId;
  const myCertified = isP1 ? match.player1_certified : match.player2_certified;
  const myDeposited = isP1 ? match.player1_deposited : match.player2_deposited;
  const opponentCertified = isP1 ? match.player2_certified : match.player1_certified;
  const opponentDeposited = isP1 ? match.player2_deposited : match.player1_deposited;

  const handleCertify = async () => {
    setCertifying(true);
    try {
      await base44.functions.invoke("certifyFairPlay", { matchId: match.id });
    } finally {
      setCertifying(false);
    }
  };

  const handleReserve = async () => {
    setReserving(true);
    try {
      await base44.functions.invoke("lockWager", { matchId: match.id });
    } finally {
      setReserving(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
  };

  return (
    <div className="space-y-5 lg:space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-white/30">Preparing Match</p>

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

      {!myDeposited && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Cost Breakdown</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Contest Entry Amount</span>
            <span className="font-semibold text-white/80">${financials.entryAmount.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Platform Service Fee (10%)</span>
            <span className="font-semibold text-white/80">${financials.serviceFee.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm pt-1.5 border-t border-white/10">
            <span className="text-white/70">Total Charged Today</span>
            <span className="font-bold text-white">${financials.totalCharge.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#C9A84C]/70">Potential Winner Award</span>
            <span className="font-bold text-[#C9A84C]">${financials.potentialWinnerAward.toFixed(2)}</span>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white/[0.03] p-4 space-y-2.5">
        <p className="text-[10px] uppercase tracking-widest text-white/30">Your Readiness</p>
        <ReadinessRow label="Fair Play Certification" done={myCertified} />
        <ReadinessRow label="Entry Amount Reserved" done={myDeposited} />
      </div>

      <div className="rounded-2xl bg-white/[0.03] p-4 space-y-2.5">
        <p className="text-[10px] uppercase tracking-widest text-white/30">Opponent Status</p>
        <ReadinessRow label="Fair Play Certification" done={opponentCertified} />
        <ReadinessRow label="Entry Amount Reserved" done={opponentDeposited} />
      </div>

      {!myCertified && (
        <div className="space-y-3">
          <FairPlayAttestation checked={agree} onCheckedChange={setAgree} />
          <Button
            onClick={handleCertify}
            disabled={!agree || certifying}
            className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90"
          >
            {certifying ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
            Certify Fair Play
          </Button>
        </div>
      )}

      {myCertified && !myDeposited && (
        <Button
          onClick={handleReserve}
          disabled={reserving}
          className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90"
        >
          {reserving ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
          Pay ${financials.totalCharge.toFixed(2)} & Reserve Entry
        </Button>
      )}

      {myCertified && myDeposited && (
        <div className="flex items-center justify-center gap-2 text-[#C9A84C] py-1">
          <Check size={16} />
          <span className="text-sm font-semibold">You're ready — waiting for opponent...</span>
        </div>
      )}

      <Button
        onClick={handleCancel}
        disabled={cancelling}
        variant="outline"
        className="w-full h-11 rounded-2xl border-white/10 text-white/60 font-semibold hover:bg-white/5"
      >
        {cancelling ? <Loader2 size={14} className="animate-spin" /> : "Cancel Match"}
      </Button>
    </div>
  );
}