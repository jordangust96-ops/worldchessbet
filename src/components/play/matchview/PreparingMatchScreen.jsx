import React, { useState, useEffect } from "react";
import { Check, Clock3, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import FairPlayAttestation from "@/components/play/matchview/FairPlayAttestation";
import { computeContestFinancials } from "@/lib/contestFinancials";
import { getBrowserGeolocation, getDeviceFingerprintHash } from "@/lib/deviceContext";

const PREPARATION_TIMEOUT_MS = 2 * 60 * 1000;

function PlayerReadiness({ label, ready, processing = false, isSelf = false }) {
  let status = isSelf ? "Action required" : "Waiting";
  let statusClass = "text-white/40 bg-white/[0.04]";
  let icon = null;

  if (processing) {
    status = "Processing";
    statusClass = "text-[#C9A84C] bg-[#C9A84C]/10";
    icon = <Loader2 size={12} className="animate-spin" />;
  } else if (ready) {
    status = "Ready";
    statusClass = "text-[#C9A84C] bg-[#C9A84C]/10";
    icon = <Check size={12} />;
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-3 py-2.5">
      <span className="text-sm font-medium text-white/70">{label}</span>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass}`}>
        {icon}
        {status}
      </span>
    </div>
  );
}

function secondsRemaining(startedAt) {
  if (!startedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return null;
  return Math.max(0, Math.ceil((startedMs + PREPARATION_TIMEOUT_MS - Date.now()) / 1000));
}

function formatCountdown(seconds) {
  if (seconds == null) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

// Shared readiness screen for both players. One explicit action records the
// per-match Fair Play agreement and reserves the disclosed contest funds.
// The server coordinates those existing operations idempotently, while the
// Match subscription remains the authority for both players' live status.
export default function PreparingMatchScreen({ match, userId, opponentId, onCancel }) {
  const [opponentName, setOpponentName] = useState("Opponent");
  const [agree, setAgree] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    secondsRemaining(match.preparation_started_at)
  );

  useEffect(() => {
    if (!opponentId) return;
    base44.functions.invoke("getUserDisplayNames", { userIds: [opponentId] }).then(({ data }) => {
      setOpponentName(data?.names?.[opponentId] || "Opponent");
    });
  }, [opponentId]);

  useEffect(() => {
    const update = () => setRemainingSeconds(secondsRemaining(match.preparation_started_at));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [match.preparation_started_at]);

  const financials = computeContestFinancials(match.wager_amount, match.platform_service_fee);
  const isP1 = match.player1_id === userId;
  const myCertified = isP1 ? match.player1_certified : match.player2_certified;
  const myDeposited = isP1 ? match.player1_deposited : match.player2_deposited;
  const opponentCertified = isP1 ? match.player2_certified : match.player1_certified;
  const opponentDeposited = isP1 ? match.player2_deposited : match.player1_deposited;
  const myReady = Boolean(myCertified && myDeposited);
  const opponentReady = Boolean(opponentCertified && opponentDeposited);
  const consentSatisfied = Boolean(myCertified || agree);

  // Self-healing safety net for a rare partial transition after both players
  // are ready. finalizeMatchStart is idempotent and creates at most one Game.
  useEffect(() => {
    if (!(myReady && opponentReady)) return;
    if (match.status === "in_progress" || match.status === "completed") return;
    const timer = window.setTimeout(() => {
      base44.functions.invoke("finalizeMatchStart", { matchId: match.id }).catch(() => {});
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [myReady, opponentReady, match.status, match.id]);

  const handleConfirmReadiness = async () => {
    if (!consentSatisfied || myReady) return;
    setConfirming(true);
    setActionError("");

    try {
      // Secondary fraud/forensic signals are collected immediately before the
      // paid action. They remain non-authoritative and never bypass the
      // server's jurisdiction, identity, balance, or participation checks.
      const geo = await getBrowserGeolocation();
      const deviceFingerprintHash = await getDeviceFingerprintHash();
      const { data } = await base44.functions.invoke("confirmMatchReadiness", {
        matchId: match.id,
        browserGeoPermission: geo.permission,
        browserLatitude: geo.latitude,
        browserLongitude: geo.longitude,
        browserAccuracyMeters: geo.accuracyMeters,
        deviceFingerprintHash,
      });
      if (data?.error) setActionError(data.error);
    } catch (error) {
      setActionError(
        error?.response?.data?.error ||
          error?.response?.data?.reason ||
          "Unable to confirm your readiness. Please try again."
      );
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-4 lg:space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30">Match Found</p>
          <h2 className="mt-0.5 text-lg font-bold text-white">Ready up to begin</h2>
        </div>
        {remainingSeconds != null && (
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
              remainingSeconds <= 30
                ? "bg-red-500/10 text-red-300"
                : "bg-white/[0.05] text-white/55"
            }`}
          >
            <Clock3 size={13} />
            {formatCountdown(remainingSeconds)}
          </div>
        )}
      </div>

      {opponentReady && !myReady && (
        <div className="rounded-xl border border-[#C9A84C]/25 bg-[#C9A84C]/8 px-3.5 py-3">
          <p className="text-sm font-semibold text-[#E5CA7A]">
            {opponentName} is ready. Confirm now to start the match.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
          <User size={17} className="text-white/50" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30">Opponent</p>
          <p className="font-bold text-white">{opponentName}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/5 p-3.5">
          <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]/60">Entry Amount</p>
          <p className="mt-1 text-xl font-bold text-[#C9A84C]">
            ${financials.entryAmount.toFixed(2)}
          </p>
        </div>
        <div className="rounded-2xl bg-white/[0.03] p-3.5">
          <p className="text-[10px] uppercase tracking-widest text-white/30">Time Control</p>
          <p className="mt-1 font-bold text-white">{match.display_name}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Contest Entry Amount</span>
          <span className="font-semibold text-white/80">${financials.entryAmount.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Platform Service Fee</span>
          <span className="font-semibold text-white/80">${financials.serviceFee.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm">
          <span className="font-semibold text-white/75">Total Reserved</span>
          <span className="font-bold text-white">${financials.totalCharge.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#C9A84C]/70">Potential Winner Award</span>
          <span className="font-bold text-[#C9A84C]">
            ${financials.potentialWinnerAward.toFixed(2)}
          </span>
        </div>
        <p className="pt-1 text-[11px] leading-relaxed text-white/40">
          The service fee is separate from the Contest Entry Amount and is refunded if the match
          is cancelled, voided, or ends without a decisive result.
        </p>
      </div>

      <div className="space-y-2">
        <PlayerReadiness label="You" ready={myReady} processing={confirming} isSelf />
        <PlayerReadiness label={opponentName} ready={opponentReady} />
      </div>

      {!myReady && (
        <div className="space-y-3">
          <FairPlayAttestation
            checked={consentSatisfied}
            disabled={Boolean(myCertified)}
            onCheckedChange={setAgree}
          />
          <Button
            onClick={handleConfirmReadiness}
            disabled={!consentSatisfied || confirming || remainingSeconds === 0}
            className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90"
          >
            {confirming && <Loader2 className="mr-2 animate-spin" size={16} />}
            {confirming
              ? "Confirming readiness..."
              : `Agree & Reserve $${financials.totalCharge.toFixed(2)}`}
          </Button>
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5">
          <p className="text-center text-xs text-red-300">{actionError}</p>
        </div>
      )}

      {myReady && (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-[#C9A84C]/8 py-3 text-[#C9A84C]">
          {opponentReady ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
          <span className="text-sm font-semibold">
            {opponentReady ? "Starting match..." : "You're ready — waiting for your opponent"}
          </span>
        </div>
      )}

      <Button
        onClick={handleCancel}
        disabled={cancelling || confirming}
        variant="outline"
        className="w-full h-10 rounded-2xl border-white/10 text-white/55 font-semibold hover:bg-white/5"
      >
        {cancelling ? <Loader2 size={14} className="animate-spin" /> : "Cancel Match"}
      </Button>
    </div>
  );
}
