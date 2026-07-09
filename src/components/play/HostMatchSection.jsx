import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, Wallet } from "lucide-react";
import { base44 } from "@/api/base44Client";

const WAGER_OPTIONS = [1, 5, 10, 25, 50, 100];

export const TIME_CONTROLS = [
  { value: "blitz", emoji: "⚡", label: "Blitz", minutes: 3 },
  { value: "rapid", emoji: "⏱", label: "Rapid", minutes: 10 },
  { value: "classical", emoji: "🧠", label: "Classical", minutes: 15 },
];

export default function HostMatchSection({ userId, balance, onHosted, disabled }) {
  const [wagerInput, setWagerInput] = useState("");
  const [timeControl, setTimeControl] = useState("rapid");
  const [hosting, setHosting] = useState(false);

  const wagerValue = parseFloat(wagerInput);
  const isValid = !isNaN(wagerValue) && wagerValue > 0;
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

  const handleHost = async () => {
    if (!isValid || !userId) return;
    setHosting(true);
    const match = await base44.entities.Match.create({
      player1_id: userId,
      wager_amount: wagerValue,
      time_control: timeControl,
      display_name: selectedTimeControl.label,
      status: "searching",
    });
    setWagerInput("");
    setHosting(false);
    onHosted?.(match);
  };

  const buttonWagerLabel = isValid ? `$${wagerValue.toFixed(2).replace(/\.00$/, "")}` : null;

  return (
    <div className="space-y-3 lg:space-y-2">
      {noFunds && !disabled && (
        <div className="rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 p-3 flex items-center gap-2.5">
          <Wallet size={15} className="text-[#C9A84C] shrink-0" />
          <p className="text-xs text-[#C9A84C]/80 leading-snug">
            Add funds to host a match.{" "}
            <Link to="/wallet" className="underline font-semibold hover:text-[#C9A84C]">
              Fund Wallet
            </Link>
          </p>
        </div>
      )}

      <div className={`space-y-5 lg:space-y-2 ${disabled || noFunds ? "opacity-40 pointer-events-none" : ""}`}>
        <div>
          <h3 className="text-base lg:text-sm font-bold text-white">Host a Match</h3>
          <p className="text-xs text-white/40 mt-0.5 lg:hidden">Choose your wager and wait for another player to accept.</p>
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
            Custom Wager
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
              placeholder="Enter any amount"
              disabled={disabled}
              className="w-full h-12 lg:h-8 pl-8 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm lg:text-xs font-semibold focus:border-[#C9A84C]/50 focus:outline-none transition-colors"
            />
          </div>
        </div>

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

        <Button
          onClick={handleHost}
          disabled={!isValid || hosting || disabled || noFunds}
          className="w-full h-12 lg:h-9 lg:text-sm rounded-2xl font-bold gold-gradient text-black hover:opacity-90 disabled:opacity-30 transition-opacity"
        >
          {hosting ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
          {isValid ? `Host ${buttonWagerLabel} ${selectedTimeControl.label} Match` : "Host a Match"}
        </Button>
      </div>
    </div>
  );
}