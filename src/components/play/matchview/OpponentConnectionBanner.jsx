import React from "react";
import { createPortal } from "react-dom";
import { WifiOff } from "lucide-react";

export default function OpponentConnectionBanner({ connection, serverNowMs }) {
  const seconds = connection.deadlineMs != null && Number.isFinite(serverNowMs)
    ? Math.max(0, Math.ceil((connection.deadlineMs - serverNowMs) / 1000)) : null;
  const countdown = seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const message = connection.deadlineMs === null ? "Countdown starts on their turn"
    : seconds === null ? "Syncing countdown…"
    : seconds > 0 ? `Forfeits in ${countdown}` : "Confirming result…";

  const notice = (
    <div className="flex min-h-10 items-center gap-2 rounded-xl border border-amber-500/35 bg-[#231d12] px-3 py-1">
      <WifiOff className="size-4 shrink-0 text-amber-400" aria-hidden="true" />
      <div className="min-w-0 text-[11px] leading-4">
        <p className="font-semibold text-amber-300" role="status">Opponent disconnected</p>
        <p className="tabular-nums text-amber-200/85" role={seconds !== null ? "timer" : undefined}>{message}</p>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden lg:block" data-testid="opponent-connection-desktop">{notice}</div>
      {typeof document !== "undefined" && createPortal(
        <div className="mobile-opponent-connection fixed z-[51] mx-auto max-w-lg lg:hidden" data-testid="opponent-connection-mobile">
          {notice}
        </div>,
        document.body
      )}
    </>
  );
}
