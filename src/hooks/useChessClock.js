import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";

function finiteMs(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

// The server returns a clock snapshot calculated at request time. The browser
// advances it with performance.now(), which is monotonic and unaffected by an
// incorrect device clock. Periodic and visibility-change resyncs bound network
// drift; only checkTimeout can decide the official result.
export function useChessClock(game) {
  const [displayMs, setDisplayMs] = useState({ w: 0, b: 0 });
  const snapshotRef = useRef(null);
  const syncSequenceRef = useRef(0);
  const timeoutFlaggedRef = useRef(false);

  const syncClock = useCallback(async () => {
    if (!game?.id || game.status === "completed") return;

    const sequence = ++syncSequenceRef.current;
    const requestStartedAt = performance.now();

    try {
      const { data } = await base44.functions.invoke("getGameClock", { gameId: game.id });
      if (sequence !== syncSequenceRef.current || !data) return;

      const receivedAt = performance.now();
      const estimatedOneWayLatencyMs = Math.max(0, (receivedAt - requestStartedAt) / 2);
      const activeColor = data.active_color === "b" ? "b" : "w";
      let whiteMs = finiteMs(data.white_remaining_ms);
      let blackMs = finiteMs(data.black_remaining_ms);

      if (activeColor === "w") whiteMs = Math.max(0, whiteMs - estimatedOneWayLatencyMs);
      if (activeColor === "b") blackMs = Math.max(0, blackMs - estimatedOneWayLatencyMs);

      snapshotRef.current = {
        w: whiteMs,
        b: blackMs,
        activeColor,
        anchoredAt: receivedAt,
      };
      setDisplayMs({ w: whiteMs, b: blackMs });

      if ((activeColor === "w" ? whiteMs : blackMs) > 0) {
        timeoutFlaggedRef.current = false;
      }
    } catch {
      // Keep the last monotonic snapshot running. The next scheduled, focus,
      // realtime, or polling refresh will try again.
    }
  }, [game?.id, game?.status]);

  useEffect(() => {
    if (!game) {
      snapshotRef.current = null;
      setDisplayMs({ w: 0, b: 0 });
      return;
    }

    const raw = {
      w: finiteMs(game.white_time_ms),
      b: finiteMs(game.black_time_ms),
    };

    if (game.status === "completed") {
      snapshotRef.current = null;
      setDisplayMs(raw);
      return;
    }

    // Immediate fallback while the server snapshot is in flight. This starts
    // from the stored authoritative values and is replaced as soon as the
    // server-calculated remaining time arrives.
    snapshotRef.current = {
      ...raw,
      activeColor: game.fen?.split(" ")[1] === "b" ? "b" : "w",
      anchoredAt: performance.now(),
    };
    setDisplayMs(raw);
    timeoutFlaggedRef.current = false;
    syncClock();

    const resyncInterval = setInterval(syncClock, 5000);
    const resyncWhenVisible = () => {
      if (!document.hidden) syncClock();
    };
    document.addEventListener("visibilitychange", resyncWhenVisible);
    window.addEventListener("focus", syncClock);

    return () => {
      clearInterval(resyncInterval);
      document.removeEventListener("visibilitychange", resyncWhenVisible);
      window.removeEventListener("focus", syncClock);
    };
  }, [
    game?.id,
    game?.status,
    game?.fen,
    game?.white_time_ms,
    game?.black_time_ms,
    game?.turn_started_at,
    syncClock,
  ]);

  useEffect(() => {
    if (!game?.id || game.status === "completed") return;

    const tick = () => {
      const snapshot = snapshotRef.current;
      if (!snapshot) return;

      const elapsedMs = Math.max(0, performance.now() - snapshot.anchoredAt);
      const whiteMs = snapshot.activeColor === "w" ? Math.max(0, snapshot.w - elapsedMs) : snapshot.w;
      const blackMs = snapshot.activeColor === "b" ? Math.max(0, snapshot.b - elapsedMs) : snapshot.b;
      setDisplayMs({ w: whiteMs, b: blackMs });

      const activeRemaining = snapshot.activeColor === "w" ? whiteMs : blackMs;
      if (activeRemaining <= 0 && !timeoutFlaggedRef.current) {
        timeoutFlaggedRef.current = true;
        base44.functions
          .invoke("checkTimeout", { gameId: game.id })
          .then(({ data }) => {
            if (data?.game?.status !== "completed") {
              timeoutFlaggedRef.current = false;
              syncClock();
            }
          })
          .catch(() => {
            timeoutFlaggedRef.current = false;
          });
      }
    };

    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [game?.id, game?.status, syncClock]);

  return displayMs;
}
