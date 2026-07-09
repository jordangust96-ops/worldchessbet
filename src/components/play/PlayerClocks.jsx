import React from "react";
import { useChessClock } from "@/hooks/useChessClock";

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function PlayerClocks({ game, orientation }) {
  const displayMs = useChessClock(game);
  if (!game) return null;

  const activeColor = game.fen?.split(" ")[1] === "b" ? "b" : "w";
  const topColor = orientation === "white" ? "b" : "w";
  const bottomColor = orientation === "white" ? "w" : "b";

  const Clock = ({ color }) => (
    <div
      className={`px-4 py-2 rounded-xl font-mono text-lg font-bold tabular-nums transition-colors ${
        activeColor === color ? "bg-[#C9A84C] text-black" : "bg-white/[0.06] text-white/70"
      }`}
    >
      {formatClock(color === "w" ? displayMs.w : displayMs.b)}
    </div>
  );

  return (
    <div className="flex items-center justify-between w-full">
      <Clock color={topColor} />
      <Clock color={bottomColor} />
    </div>
  );
}