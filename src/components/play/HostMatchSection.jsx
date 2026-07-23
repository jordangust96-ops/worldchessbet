import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, Wallet, Lock } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { computeContestFinancials } from "@/lib/contestFinancials";
import { useAuth } from "@/lib/AuthContext";
import { getJurisdictionMessage } from "@/lib/jurisdictionConfig";
import { trackPixelEvent } from "@/lib/metaPixel";

const WAGER_OPTIONS = [1, 5, 10, 25, 50, 100];

export const TIME_CONTROLS = [
  { value: "blitz", emoji: "⚡", label: "Blitz", minutes: 3 },
  { value: "rapid", emoji: "⏱", label: "Rapid", minutes: 10 },
  { value: "classical", emoji: "🧠", label: "Classical", minutes: 15 },
];

// A single wager/time-control configuration, published either publicly (to
// the marketplace) or privately (via an invite link) — same Match, same
// escrow/gameplay/settlement flow either way. Only the publish button differs.
export default function HostMatchSection({ userId, balance, onHosted, disabled }) {
  const { jurisdictionStatus, jurisdictionReason } = useAuth();
  const jurisdictionBlocked = !!jurisdictionStatus && jurisdictionStatus !== "approved";
  const [wagerInput, setWagerInput] = useState("");
  const [timeControl, setTimeControl] = useState("rapid");
  const [hosting, setHosting] = useState(false);
  const [hostError, setHostError] = useState("");

  const wagerValue = parseFloat(wagerInput);
  const isValid = !isNaN(wagerValue) && wagerValue >= 1;
  const selectedPreset = WAGER_OPTIONS.find((amount) => amount === wagerValue);
  const selectedTimeControl = TIME_CONTROLS.find((tc) => tc.value === timeControl);
  const noFunds = balance <= 0;

  const handlePresetClick = (amount) => {
    setWagerInput(String(amount));
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
      setWagerInput(value);
    }
  };

  const handleHost = async (isPrivate) => {
    if (!isValid || !userId) return;
    setHosting(true);
    setHostError("");
    // Runs server-side (createMatch): validates eligibility and balance, places
    // the Entry Hold (Available -> Held + ledger entries), and only then
    // creates the Match — so it's never published unless already fully funded.
    const { data } = await base44.functions.invoke("createMatch", {
      wagerAmount: wagerValue,
      timeControl,
      displayName: selectedTimeControl.label,
      isPrivate,
    });
    setHosting(false);
    if (data?.match) {
      trackPixelEvent("Match Hosted", { value: wagerValue, currency: "USD", time_control: timeControl });
      setWagerInput("");
      onHosted?.(data.match);
    } else {
      setHostError(data?.error || "Unable to create this challenge right now.");
    }
  };

  const buttonWagerLabel = isValid ? `$${wagerValue.toFixed(2).replace(/\.00$/, "")}` : null;
  const financials = isValid ? computeContestFinancials(wagerValue) : null;

  return (
    <div className="space-y-3 lg:space-y-2">
      {noFunds && !disabled && (
        <div className="rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 p-3 flex items-center gap-2.5">
          <Wallet size={15} className="text-[#C9A84C] shrink-0" />
          <p className="text-xs text-[#C9A84C]/80 leading-snug">
            Add funds to create a challenge.{" "}
            <Link to="/wallet" className="underline font-semibold hover:text-[#C9A84C]">
              Fund Wallet
            </Link>
          </p>
        </div>
      )}

      {jurisdictionBlocked && (
        <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-3">
          <p className="text-xs text-red-400/80 leading-snug whitespace-pre-line">
            {jurisdictionReason || getJurisdictionMessage(jurisdictionStatus)}
          </p>
        </div>
      )}

      <div className={`space-y-5 lg:space-y-2 ${disabled || noFunds || jurisdictionBlocked ? "opacity-40 pointer-events-none" : ""}`}>
        <div>
          <h3 className="text-base lg:text-sm font-bold text-white">Create a Challenge</h3>
          <p className="text-xs text-white/40 mt-0.5 lg:hidden">Choose your entry amount and time control, then create your challenge publicly or privately.</p>
          {disabled && (
            <p className="text-xs text-[#C9A84C]/70 mt-1">
              You already have an active challenge. Cancel it to create a new one.
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2.5 lg:gap-1.5">
          {WAGER_OPTIONS.map((amount) => {
            const isActive = selectedPreset === amount;
            const canAfford = balance >= amount;
            return (
              <button
                key={amount}
                onClick={() => canAfford && handlePresetClick(amount)}
                disabled={!canAfford || disabled}
                className={`h-12 lg:h-8 rounded-xl font-bold text-sm lg:text-xs transition-all ${
                  isActive
                    ? "gold-gradient text-black"
                    : canAfford
                    ? "bg-white/[0.06] text-white border border-white/10 hover:border-[#C9A84C]/30"
                    : "bg-white/[0.03] text-white/20 border border-white/5 cursor-not-allowed"
                }`}
              >
                ${amount}
              </button>
            );
          })}
        </div>

        <div className="space-y-2 lg:space-y-1">
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Custom Entry Amount
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-semibold text-sm">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={wagerInput}
              onChange={handleInputChange}
              placeholder="Enter amount (min $1)"
              disabled={disabled}
              className="w-full h-12 lg:h-8 pl-8 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm lg:text-xs font-semibold focus:border-[#C9A84C]/50 focus:outline-none transition-colors"
            />
          </div>
        </div>

        {financials && (
          <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Contest Entry Amount</span>
              <span className="font-semibold text-white/80">${financials.entryAmount.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Platform Service Fee (10%)</span>
              <span className="font-semibold text-white/80">${financials.serviceFee.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-white/10">
              <span className="text-white/40">Total Amount Due</span>
              <span className="font-semibold text-white">${financials.totalCharge.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#C9A84C]/70">Potential Winner Award</span>
              <span className="font-bold text-[#C9A84C]">${financials.potentialWinnerAward.toFixed(2)}</span>
            </div>
          </div>
        )}

        <div className="space-y-2 lg:space-y-1">
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Time Control
          </label>
          <div className="space-y-2 lg:space-y-1">
            {TIME_CONTROLS.map((tc) => {
              const isActive = timeControl === tc.value;
              return (
                <button
                  key={tc.value}
                  onClick={() => setTimeControl(tc.value)}
                  disabled={disabled}
                  className={`w-full flex items-center gap-3 lg:gap-2 p-3 lg:p-1.5 rounded-xl text-left transition-all ${
                    isActive
                      ? "gold-gradient text-black"
                      : "bg-white/[0.06] text-white border border-white/10 hover:border-[#C9A84C]/30"
                  }`}
                >
                  <span className="text-lg lg:text-sm">{tc.emoji}</span>
                  <div className="flex-1">
                    <p className="font-bold text-sm lg:text-xs">{tc.label}</p>
                    <p className={`text-xs ${isActive ? "text-black/60" : "text-white/40"}`}>{tc.minutes} Minutes</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 lg:space-y-1.5">
          <Button
            onClick={() => handleHost(false)}
            disabled={!isValid || hosting || disabled || noFunds || jurisdictionBlocked}
            className="w-full h-12 lg:h-9 lg:text-sm rounded-2xl font-bold gold-gradient text-black hover:opacity-90 disabled:opacity-30 transition-opacity"
          >
            {hosting ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
            {isValid ? `Create ${buttonWagerLabel} ${selectedTimeControl.label} Challenge` : "Create a Public Challenge"}
          </Button>
          <Button
            onClick={() => handleHost(true)}
            disabled={!isValid || hosting || disabled || noFunds || jurisdictionBlocked}
            variant="outline"
            className="w-full h-12 lg:h-9 lg:text-sm rounded-2xl font-bold border-white/10 text-white/70 hover:bg-white/5 hover:text-white disabled:opacity-30 transition-colors"
          >
            {hosting ? <Loader2 className="animate-spin mr-2" size={16} /> : <Lock size={14} className="mr-2" />}
            Create a Private Challenge
          </Button>
          {hostError && <p className="text-xs text-red-400 text-center">{hostError}</p>}
        </div>
      </div>
    </div>
  );
}