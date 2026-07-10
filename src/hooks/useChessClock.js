import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

// Displays a locally-ticking countdown for each side, reconciled from the
// server-authoritative Game fields (white_time_ms, black_time_ms, turn_started_at)
// on every realtime update. The client never decides the official time — it only
// interpolates between server snapshots for a smooth countdown, and flags a
// timeout to the backend (checkTimeout) for authoritative confirmation.
export function useChessClock(game) {
  const [displayMs, setDisplayMs] = useState({ w: 0, b: 0 });
  const timeoutFlaggedRef = useRef(false);
  // Estimated (server time - client time) skew, in ms. Client device clocks are
  // frequently off from the server's — sometimes by many seconds — which made the
  // local countdown run fast/slow on whichever device had a skewed clock, even
  // though the stored server values were always correct. Recomputed on every
  // fresh Game snapshot (poll/subscription) from its server-set updated_date, so
  // raw Date.now() is never used directly against the server's turn_started_at.
  const clockSkewMsRef = useRef(0);

  useEffect(() => {
    if (game?.updated_date) {
      clockSkewMsRef.current = new Date(game.updated_date).getTime() - Date.now();
    }
  }, [game?.updated_date]);

  useEffect(() => {
    if (!game || game.status === "completed") return;

    const activeColor = game.fen?.split(" ")[1] === "b" ? "b" : "w";
    timeoutFlaggedRef.current = false;

    const tick = () => {
      const now = Date.now() + clockSkewMsRef.current;
      const turnStartedAt = game.turn_started_at ? new Date(game.turn_started_at).getTime() : now;
      const elapsed = Math.max(0, now - turnStartedAt);

      const whiteMs = activeColor === "w" ? Math.max(0, (game.white_time_ms ?? 0) - elapsed) : game.white_time_ms ?? 0;
      const blackMs = activeColor === "b" ? Math.max(0, (game.black_time_ms ?? 0) - elapsed) : game.black_time_ms ?? 0;

      setDisplayMs({ w: whiteMs, b: blackMs });

      const activeRemaining = activeColor === "w" ? whiteMs : blackMs;
      if (activeRemaining <= 0 && !timeoutFlaggedRef.current) {
        timeoutFlaggedRef.current = true;
        base44.functions.invoke("checkTimeout", { gameId: game.id });
      }
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [game]);

  return displayMs;
}