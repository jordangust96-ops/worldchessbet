import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";

function finiteMs(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
function serverTime(value) {
  if (!value) return NaN;
  return Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + "Z");
}
function positionKey(game) {
  return [game?.id, game?.status, game?.fen, game?.turn_started_at,
    game?.white_time_ms, game?.black_time_ms].join("|");
}

// Board, turn and clocks must describe the SAME server position. Never let an
// independently arriving clock response switch the running side on an old board.
export function useChessClock(game, onGameSync) {
  const [displayMs, setDisplayMs] = useState({ w: 0, b: 0 });
  const snapshotRef = useRef(null);
  const serverAnchorRef = useRef(null);
  const currentRef = useRef({ game, onGameSync });
  currentRef.current = { game, onGameSync };
  const syncSequenceRef = useRef(0);
  const inFlightRef = useRef(null);
  const timeoutRequestRef = useRef(null);
  const nextTimeoutAtRef = useRef(0);

  const syncClock = useCallback(async () => {
    const current = currentRef.current.game;
    if (!current?.id || current.status !== "active") return;
    const key = positionKey(current);
    // Coalesce focus/online/visibility bursts; a hung request can be superseded.
    if (inFlightRef.current?.key === key &&
        performance.now() - inFlightRef.current.startedAt < 10000) return;
    const operation = { key, startedAt: performance.now(), sequence: ++syncSequenceRef.current };
    inFlightRef.current = operation;
    try {
      const { data } = await base44.functions.invoke("getGameClock", { gameId: current.id });
      const latest = currentRef.current.game;
      if (operation.sequence !== syncSequenceRef.current || !data ||
          positionKey(latest) !== key || data.game_id !== latest?.id) return;

      const receivedAt = performance.now();
      // The sample is computed near response time. A slow server request is
      // not all transit time: bound compensation to avoid a premature zero.
      const latencyMs = Math.min(250, Math.max(0, (receivedAt - operation.startedAt) / 2));
      if (Number.isFinite(data.server_now_ms)) {
        serverAnchorRef.current = { gameId: latest.id, serverMs: data.server_now_ms + latencyMs, at: receivedAt };
      }
      const matches = data.status === latest.status &&
        data.active_color === latest.fen?.split(" ")[1] &&
        data.turn_started_at === latest.turn_started_at &&
        (!data.fen || data.fen === latest.fen);
      if (!matches) {
        // The clock endpoint can recover a missed realtime move, but the
        // shared monotonic game reducer decides whether that state is newer.
        if (data.game) currentRef.current.onGameSync?.(data.game);
        return;
      }
      const activeColor = data.active_color;
      const w = Math.max(0, finiteMs(data.white_remaining_ms) - (activeColor === "w" ? latencyMs : 0));
      const b = Math.max(0, finiteMs(data.black_remaining_ms) - (activeColor === "b" ? latencyMs : 0));
      snapshotRef.current = { key, w, b, activeColor, anchoredAt: receivedAt };
      setDisplayMs({ w, b });
      if (data.game) currentRef.current.onGameSync?.(data.game);
    } catch {
      // Keep the monotonic clock; the visible recovery interval retries.
    } finally {
      if (inFlightRef.current === operation) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    syncSequenceRef.current++;
    inFlightRef.current = null;
    nextTimeoutAtRef.current = 0;
    const raw = { w: finiteMs(game?.white_time_ms), b: finiteMs(game?.black_time_ms) };
    const key = positionKey(game);
    if (!game || game.status !== "active") {
      snapshotRef.current = null;
      setDisplayMs(raw);
      return;
    }
    const now = performance.now();
    const anchor = serverAnchorRef.current;
    const turnAt = serverTime(game.turn_started_at);
    const calibrated = anchor?.gameId === game.id && Number.isFinite(turnAt);
    const elapsed = calibrated ? Math.max(0, anchor.serverMs + now - anchor.at - turnAt) : 0;
    const activeColor = game.fen?.split(" ")[1];
    const remaining = {
      w: Math.max(0, raw.w - (activeColor === "w" ? elapsed : 0)),
      b: Math.max(0, raw.b - (activeColor === "b" ? elapsed : 0)),
    };
    // A new position is projected from calibrated server time, never from the
    // phone's wall clock, and never reset to an unelapsed stored balance.
    snapshotRef.current = { key, ...remaining, activeColor: calibrated ? activeColor : null, anchoredAt: now };
    setDisplayMs(remaining);
    void syncClock();
    return () => { syncSequenceRef.current++; };
  }, [game?.id, game?.status, game?.fen, game?.white_time_ms, game?.black_time_ms, game?.turn_started_at, syncClock]);

  useEffect(() => {
    if (!game?.id || game.status !== "active") return;
    const resyncWhenVisible = () => {
      if (document.visibilityState === "visible") void syncClock();
    };
    const resyncInterval = setInterval(resyncWhenVisible, 5000);
    document.addEventListener("visibilitychange", resyncWhenVisible);
    window.addEventListener("focus", resyncWhenVisible);
    window.addEventListener("online", resyncWhenVisible);
    return () => {
      syncSequenceRef.current++;
      clearInterval(resyncInterval);
      document.removeEventListener("visibilitychange", resyncWhenVisible);
      window.removeEventListener("focus", resyncWhenVisible);
      window.removeEventListener("online", resyncWhenVisible);
    };
  }, [game?.id, game?.status, syncClock]);

  useEffect(() => {
    if (!game?.id || game.status !== "active") return;
    const tick = () => {
      const current = currentRef.current.game;
      const snapshot = snapshotRef.current;
      if (!snapshot || snapshot.key !== positionKey(current)) return;
      const elapsed = Math.max(0, performance.now() - snapshot.anchoredAt);
      const w = snapshot.activeColor === "w" ? Math.max(0, snapshot.w - elapsed) : snapshot.w;
      const b = snapshot.activeColor === "b" ? Math.max(0, snapshot.b - elapsed) : snapshot.b;
      setDisplayMs({ w, b });
      const remaining = snapshot.activeColor === "w" ? w : snapshot.activeColor === "b" ? b : Infinity;
      if (remaining > 0 || timeoutRequestRef.current || performance.now() < nextTimeoutAtRef.current) return;
      // A display reaching zero is only a request for server verification.
      // Bound retries even when offline; never issue one request per tick.
      const operation = { gameId: current.id };
      timeoutRequestRef.current = operation;
      nextTimeoutAtRef.current = performance.now() + 3000;
      base44.functions.invoke("checkTimeout", { gameId: current.id })
        .then(({ data }) => {
          if (currentRef.current.game?.id !== operation.gameId) return;
          if (data?.game) currentRef.current.onGameSync?.(data.game);
          if (data?.game?.status !== "completed") void syncClock();
        })
        .catch(() => {})
        .finally(() => {
          if (timeoutRequestRef.current === operation) timeoutRequestRef.current = null;
        });
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [game?.id, game?.status, syncClock]);
  return displayMs;
}

