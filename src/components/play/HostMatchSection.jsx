import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, Wallet } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { computeContestFinancials, getPlatformServiceFee } from "@/lib/contestFinancials";
import { trackPixelEvent } from "@/lib/metaPixel";

import { ENTRY_AMOUNT_GROUPS as PRESET_GROUPS } from '../../../base44/shared/challengePolicy.js';

const DEFAULT_WAGER = 10;

export const TIME_CONTROLS = [
  { value: "blitz", emoji: "⚡", label: "Blitz", minutes: 3 },
  { value: "rapid", emoji: "⏱", label: "Rapid", minutes: 10 },
  { value: "classical", emoji: "🧠", label: "Classical", minutes: 15 },
];

// Public marketplace creation only. Shareable invitations use the separate
// challenge-first invitation controller and the same underlying match engine.
export default function HostMatchSection({ userId, balance, onHosted, disabled = false }) {
  const [wagerValue, setWagerValue] = useState(DEFAULT_WAGER);
  const [timeControl, setTimeControl] = useState("rapid");
  const [hosting, setHosting] = useState(false);
  const [hostError, setHostError] = useState("");
  const [availability, setAvailability] = useState(null);
  useEffect(() => {
    let cancelled = false;
    base44.functions.invoke("getLaunchAvailability", {}).then(({ data }) => {
      if (!cancelled) setAvailability(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const launchClosed = availability?.paid_contests_enabled !== true;

  const selectedTimeControl = TIME_CONTROLS.find((tc) => tc.value === timeControl);
  const noFunds = balance <= 0;
  const financials = computeContestFinancials(wagerValue);
  const canAffordTotal = financials.totalCharge !== null && balance >= financials.totalCharge;

  const handleHost = async () => {
    if (launchClosed || !wagerValue || !userId || !canAffordTotal) return;
    setHosting(true);
    setHostError("");
    try {
      // Runs server-side (createMatch): validates eligibility and balance,
      // then creates the challenge. Funds are reserved later in the shared
      // Preparing Match phase after both players have joined.
      const { data } = await base44.functions.invoke("createMatch", {
        wagerAmount: wagerValue,
        timeControl,
        displayName: selectedTimeControl.label,
        isPrivate: false,
      });
      if (data?.match) {
        trackPixelEvent("Match Hosted", { value: wagerValue, currency: "USD", time_control: timeControl });
        onHosted?.(data.match);
      } else {
        setHostError(data?.error || "Unable to create this challenge right now.");
      }
    } catch (error) {
      setHostError(
        error?.response?.data?.error ||
        error?.message ||
        "Unable to create this challenge right now."
      );
    } finally {
      setHosting(false);
    }
  };

  const buttonWagerLabel = `$${wagerValue.toLocaleString()}`;

  return (
    <div className="space-y-3 lg:space-y-2">
      {(noFunds || launchClosed) && !disabled && (
        <div className="rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 p-3 flex items-center gap-2.5">
          <Wallet size={15} className="text-[#C9A84C] shrink-0" />
          <p className="text-xs text-[#C9A84C]/80 leading-snug">
            {launchClosed ? "Paid contests are currently unavailable." : noFunds ? "Available funds are required to post or accept a public match." : availability?.deposits_enabled ? "Add funds to create a challenge." : "Deposits are currently unavailable."}{" "}
            <Link to="/wallet" className="underline font-semibold hover:text-[#C9A84C]">
              {!launchClosed && availability?.deposits_enabled ? "Fund Wallet" : "View Wallet"}
            </Link>
          </p>
        </div>
      )}

      <div className={`space-y-5 lg:space-y-2 ${disabled || launchClosed || noFunds ? "opacity-40 pointer-events-none" : ""}`}>
        <div>
          <h3 className="text-base lg:text-sm font-bold text-white">Post a Public Match</h3>
          <p className="text-xs text-white/40 mt-0.5 lg:hidden">Choose an entry amount and time control.</p>
          {disabled && (
            <p className="text-xs text-[#C9A84C]/70 mt-1">
              You already have an active challenge. Cancel it to create a new one.
            </p>
          )}
        </div>

        <div className="space-y-3 lg:space-y-1.5">
          {PRESET_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1.5 lg:space-y-1">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                {group.label}
              </label>
              <div className="grid grid-cols-3 gap-2.5 lg:gap-1.5">
                {group.amounts.map((amount) => {
                  const isActive = wagerValue === amount;
                  const fee = getPlatformServiceFee(amount) || 0;
                  const canAfford = balance >= amount + fee;
                  return (
                    <button
                      key={amount}
                      onClick={() => canAfford && setWagerValue(amount)}
                      disabled={!canAfford || disabled || launchClosed}
                      className={`h-12 lg:h-8 rounded-xl font-bold text-sm lg:text-xs transition-all ${
                        isActive
                          ? "gold-gradient text-black"
                          : canAfford
                          ? "bg-white/[0.06] text-white border border-white/10 hover:border-[#C9A84C]/30"
                          : "bg-white/[0.03] text-white/20 border border-white/5 cursor-not-allowed"
                      }`}
                    >
                      ${amount.toLocaleString()}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {financials.serviceFee !== null && (
          <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Contest Entry Amount</span>
              <span className="font-semibold text-white/80">${financials.entryAmount.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Platform Service Fee</span>
              <span className="font-semibold text-white/80">${financials.serviceFee.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-white/10">
              <span className="text-white/40">Total Authorization</span>
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
            onClick={handleHost}
            disabled={!wagerValue || hosting || disabled || launchClosed || noFunds || !canAffordTotal}
            className="w-full h-12 lg:h-9 lg:text-sm rounded-2xl font-bold gold-gradient text-black hover:opacity-90 disabled:opacity-30 transition-opacity"
          >
            {hosting ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
            Create {buttonWagerLabel} {selectedTimeControl.label} Challenge
          </Button>
          {hostError && <p className="text-xs text-red-400 text-center">{hostError}</p>}
        </div>
      </div>
    </div>
  );
}