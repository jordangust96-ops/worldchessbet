import React, { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Subtle, non-blocking indicator shown to a player while their opponent is
// recorded as disconnected. Disappears automatically the instant the Game's
// disconnected_at field clears (the opponent's heartbeat resumed) â€” no
// action needed from either player. The chess clock keeps running the whole
// time; nothing here ever pauses or adjusts it.
export default function OpponentConnectionBanner({ disconnectedAt }) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [graceSeconds, setGraceSeconds] = useState(45);

  useEffect(() => {
    if (!disconnectedAt) return;
    base44.entities.GameSettings.list().then((rows) => {
      if (rows[0]?.reconnect_grace_period_seconds) {
        setGraceSeconds(rows[0].reconnect_grace_period_seconds);
      }
    });
  }, [disconnectedAt]);

  useEffect(() => {
    if (!disconnectedAt) return;
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - new Date(disconnectedAt).getTime()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [disconnectedAt]);

  if (!disconnectedAt) return null;

  const withinGrace = elapsedSec < graceSeconds;

  return (
    <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2">
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <p className="text-[11px] text-amber-300/90">
        {withinGrace ? "Opponent disconnected." : "Opponent still disconnected."} Their clock is still running.{" "}
        <span className="tabular-nums">({elapsedSec}s)</span>
      </p>
    </div>
  );
}