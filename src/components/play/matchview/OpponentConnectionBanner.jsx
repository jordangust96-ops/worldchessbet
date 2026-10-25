import React, { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";

function gracePeriodMs(baseTimeMs, incrementMs) {
  const baseMs = Number(baseTimeMs) > 0 ? Number(baseTimeMs) : 300000;
  const increment = Math.max(0, Number(incrementMs) || 0);
  return Math.max(30000, Math.min(180000, Math.floor((baseMs + 40 * increment) * 0.1)));
}

function parseTime(value) {
  if (!value) return NaN;
  const text = String(value);
  const hasTimezone = /Z$|[+-]\\d{2}:?\\d{2}$/.test(text);
  const parsed = Date.parse(hasTimezone ? text : `${text}Z`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export default function OpponentConnectionBanner({
  disconnectedAt,
  opponentToMove,
  turnStartedAt,
  baseTimeMs,
  incrementMs,
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!disconnectedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [disconnectedAt]);

  if (!disconnectedAt) return null;

  const detectedAt = parseTime(disconnectedAt);
  const turnAt = parseTime(turnStartedAt);
  const graceMs = gracePeriodMs(baseTimeMs, incrementMs);
  const timerStartsAt = opponentToMove && Number.isFinite(turnAt)
    ? Math.max(detectedAt, turnAt)
    : null;
  const remainingSeconds = timerStartsAt === null
    ? null
    : Math.max(0, Math.ceil((graceMs - (now - timerStartsAt)) / 1000));

  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2">
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-amber-300/90">
        {!opponentToMove
          ? "ChessBet has not received your opponent’s game heartbeat. Their reconnect window starts when it is their turn; clocks keep running."
          : remainingSeconds > 0
            ? `ChessBet has not received your opponent’s game heartbeat. They have about ${remainingSeconds}s to reconnect. Their clock keeps running.`
            : "Checking for a restored connection. If no heartbeat returns, the game will end by disconnect timeout."}
      </p>
    </div>
  );
}
