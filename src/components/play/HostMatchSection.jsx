import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

const WAGER_OPTIONS = [1, 5, 10, 25, 50, 100];

export default function HostMatchSection({ userId, balance }) {
  const [wagerInput, setWagerInput] = useState("");
  const [hosting, setHosting] = useState(false);
  const navigate = useNavigate();

  const wagerValue = parseFloat(wagerInput);
  const isValid = !isNaN(wagerValue) && wagerValue > 0;
  const selectedPreset = WAGER_OPTIONS.find((amount) => amount === wagerValue);

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
      status: "searching",
    });
    navigate(`/match/${match.id}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-white">Host a Match</h3>
        <p className="text-xs text-white/40 mt-0.5">Choose your wager and wait for another player to accept.</p>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {WAGER_OPTIONS.map((amount) => {
          const isActive = selectedPreset === amount;
          const canAfford = balance >= amount;
          return (
            <button
              key={amount}
              onClick={() => canAfford && handlePresetClick(amount)}
              disabled={!canAfford}
              className={`h-12 rounded-xl font-bold text-sm transition-all ${
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

      <div className="space-y-2">
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
            className="w-full h-12 pl-8 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm font-semibold focus:border-[#C9A84C]/50 focus:outline-none transition-colors"
          />
        </div>
      </div>

      <Button
        onClick={handleHost}
        disabled={!isValid || hosting}
        className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90 disabled:opacity-30 transition-opacity"
      >
        {hosting ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
        {isValid ? `Host $${wagerValue.toFixed(2).replace(/\.00$/, "")} Match` : "Host a Match"}
      </Button>
    </div>
  );
}