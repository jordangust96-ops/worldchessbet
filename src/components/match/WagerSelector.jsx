import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const WAGER_OPTIONS = [1, 5, 10, 25, 50, 100];

export default function WagerSelector({ onSelect, balance }) {
  const [selected, setSelected] = useState(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        {WAGER_OPTIONS.map((amount) => {
          const isActive = selected === amount;
          const canAfford = balance >= amount;
          return (
            <motion.button
              key={amount}
              whileTap={{ scale: 0.95 }}
              onClick={() => canAfford && setSelected(amount)}
              disabled={!canAfford}
              className={`relative h-14 rounded-2xl font-bold text-lg transition-all ${
                isActive
                  ? "gold-gradient text-black shadow-lg shadow-[#C9A84C]/20"
                  : canAfford
                  ? "bg-white/[0.06] text-white border border-white/10 hover:border-[#C9A84C]/30"
                  : "bg-white/[0.03] text-white/20 border border-white/5 cursor-not-allowed"
              }`}
            >
              ${amount}
            </motion.button>
          );
        })}
      </div>

      <Button
        onClick={() => selected && onSelect(selected)}
        disabled={!selected}
        className="w-full h-14 rounded-2xl text-base font-bold gold-gradient text-black hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
      >
        {selected ? `Find Match · $${selected}` : "Select a Wager"}
      </Button>
    </div>
  );
}