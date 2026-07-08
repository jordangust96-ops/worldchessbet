import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

const WAGER_OPTIONS = [1, 5, 10, 25, 50, 100];

export default function HostMatchPanel({ userId, balance }) {
  const [selected, setSelected] = useState(null);
  const [hosting, setHosting] = useState(false);
  const navigate = useNavigate();

  const handleHost = async () => {
    if (!selected || !userId) return;
    setHosting(true);
    const match = await base44.entities.Match.create({
      player1_id: userId,
      wager_amount: selected,
      status: "searching",
    });
    navigate(`/match/${match.id}`);
  };

  return (
    <div className="rounded-3xl bg-white/[0.03] border border-white/5 p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white/70">Create Your Own Match</h3>
        <p className="text-xs text-white/30 mt-0.5">Set a wager and wait for a challenger</p>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {WAGER_OPTIONS.map((amount) => {
          const isActive = selected === amount;
          const canAfford = balance >= amount;
          return (
            <button
              key={amount}
              onClick={() => canAfford && setSelected(amount)}
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

      <Button
        onClick={handleHost}
        disabled={!selected || hosting}
        className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90 disabled:opacity-30 transition-opacity"
      >
        {hosting ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
        Host Match
      </Button>
    </div>
  );
}