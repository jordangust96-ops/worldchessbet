import React, { useState, useEffect } from "react";
import { Crown } from "lucide-react";

// Brief, purely client-side ceremony shown once both players are ready and
// the Game has been created/loaded — never blocks or delays the server-side
// transition to in_progress, just gives both players a shared "starting now"
// moment before the interactive board appears.
export default function MatchStartCountdown({ onDone }) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [count, onDone]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Crown size={22} className="text-[#C9A84C]" />
      <p className="text-[10px] uppercase tracking-widest text-white/40">Both Players Ready</p>
      <p className="text-6xl font-extrabold gold-text tabular-nums">{count > 0 ? count : "Go"}</p>
    </div>
  );
}