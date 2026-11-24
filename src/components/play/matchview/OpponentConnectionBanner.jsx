import React from "react";
import { WifiOff } from "lucide-react";

export default function OpponentConnectionBanner({ connection, serverNowMs, fallback = null }) {
  const seconds = connection?.deadlineMs != null && Number.isFinite(serverNowMs)
    ? Math.max(0, Math.ceil((connection.deadlineMs - serverNowMs) / 1000)) : null;
  const countdown = seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  // Reserve the same space so connection changes never move the game layout.
  return (
    <div className="h-12" data-testid="opponent-connection-slot">
      {connection ? (
        <div className="h-full flex items-center gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3">
          <WifiOff className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0 text-[11px] leading-4">
            <p className="font-semibold text-amber-300" role="status">Opponent disconnected</p>
            <p className="text-amber-200/75 tabular-nums" role={seconds !== null ? "timer" : undefined}>
              {connection.deadlineMs === null ? "Countdown starts on their turn"
                : seconds === null ? "Syncing countdown…"
                : seconds > 0 ? `Forfeits in ${countdown}` : "Confirming result…"}
            </p>
          </div>
        </div>
      ) : fallback}
    </div>
  );
}
