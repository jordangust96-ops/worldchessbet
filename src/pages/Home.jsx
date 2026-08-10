import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import Logo from "@/components/Logo";
import ChessboardPreview from "@/components/play/ChessboardPreview";
import MatchCenter from "@/components/play/MatchCenter";
import MatchView from "@/components/play/MatchView";
import DemoModeNotice from "@/components/DemoModeNotice";
import RestrictedModeBanner from "@/components/RestrictedModeBanner";
import { useChessGame } from "@/hooks/useChessGame";
import { trackPixelEvent } from "@/lib/metaPixel";
import {
  getMoveSoundCue,
  getStoredSoundPreference,
  installGameAudioUnlock,
  playGameSound,
  storeSoundPreference,
} from "@/lib/gameSounds";

export default function Home() {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const settledWalletRefreshRef = useRef(null);
  const [myMatchId, setMyMatchId] = useState(null);
  // The single authoritative Match record for the active match — sourced from
  // the one Match subscription below, and passed down to MatchView as a prop
  // instead of MatchView opening its own duplicate subscription.
  const [activeMatch, setActiveMatch] = useState(null);
  const myMatchIdRef = useRef(myMatchId);
  useEffect(() => {
    myMatchIdRef.current = myMatchId;
  }, [myMatchId]);
  const [boardState, setBoardState] = useState("marketplace");
  // Tracks the last match the player explicitly dismissed (via "Find New Match").
  // Persisted in sessionStorage (not just a ref) because navigating to another
  // tab (Wallet, Profile) unmounts Home entirely — a plain ref would reset to
  // null on remount and let the same dismissed match resurface.
  const dismissedMatchIdRef = useRef(sessionStorage.getItem("chessbet_dismissed_match_id"));
  const gameActive =
    boardState === "in_progress" || boardState === "finalizing" || boardState === "settlement";
  const isLive = boardState === "in_progress";
  const [movementMode, setMovementMode] = useState("drag");
  const [soundEnabled, setSoundEnabled] = useState(getStoredSoundPreference);
  const soundEnabledRef = useRef(soundEnabled);
  const moveSoundStateRef = useRef({ gameId: null, moveCount: 0 });
  const { fen, handleDrop, handleSquareClick, selectedSquare, legalTargets, orientation, game } =
    useChessGame(myMatchId, user?.id, gameActive);

  const handleMovementModeChange = (mode) => {
    setMovementMode(mode);
    base44.auth.updateMe({ movement_mode: mode });
  };

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    storeSoundPreference(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => installGameAudioUnlock(), []);

  const handleSoundEnabledChange = useCallback(async (enabled) => {
    const previous = soundEnabledRef.current;
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
    storeSoundPreference(enabled);
    if (enabled) playGameSound("enabled", true);
    try {
      await base44.auth.updateMe({ sound_enabled: enabled });
    } catch {
      soundEnabledRef.current = previous;
      setSoundEnabled(previous);
      storeSoundPreference(previous);
    }
  }, []);

  const handleMatchAccepted = useCallback((matchId) => {
    if (!matchId) return;
    const storageKey = "chessbet_accept_sound_match_id";
    if (sessionStorage.getItem(storageKey) !== matchId) {
      sessionStorage.setItem(storageKey, matchId);
      playGameSound("accepted", soundEnabledRef.current);
    }
    setMyMatchId(matchId);
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    // A match can stay "in_progress" for a moment after the game itself has
    // finished, while settlement is pending. Don't restore the Match View (and
    // its post-game summary) for those — treat it as no active match. Shared by
    // both the initial fetch and the realtime handler below so a stale/replayed
    // event can never resurrect a match whose game already ended.
    const isMatchGenuinelyActive = async (m) => {
      if (m.status !== "in_progress") return true;
      const games = await base44.entities.Game.filter({ match_id: m.id }, "-created_date", 1);
      return games[0]?.status !== "completed";
    };

    const checkActiveMatch = async () => {
      const asP1 = await base44.entities.Match.filter({ player1_id: user.id }, "-created_date", 5);
      const asP2 = await base44.entities.Match.filter({ player2_id: user.id }, "-created_date", 5);
      const candidates = [...asP1, ...asP2].filter(
        (m) => ["preparing", "both_ready", "in_progress"].includes(m.status) && m.id !== dismissedMatchIdRef.current
      );
      for (const m of candidates) {
        if (await isMatchGenuinelyActive(m)) {
          setMyMatchId(m.id);
          setActiveMatch(m);
          return;
        }
      }
    };
    // One-time fetch to recover the authoritative state on mount or reconnect.
    // A transient network error here must never surface as an uncaught error.
    checkActiveMatch().catch(() => {});

    const unsubscribe = base44.entities.Match.subscribe((event) => {
      if (event.data?.player1_id !== user.id && event.data?.player2_id !== user.id) return;
      if (event.type !== "update" && event.type !== "create") return;

      // This is the single authoritative Match subscription for whichever
      // match is currently active — keep it in sync for every status
      // (including cancelled/completed), not just the ones that trigger
      // switching into MatchView below.
      if (event.data.id === myMatchIdRef.current) {
        setActiveMatch(event.data);
      }

      // Never restore a match the player already dismissed via Find New Match.
      if (event.data.id === dismissedMatchIdRef.current) return;
      if (!["preparing", "both_ready", "in_progress"].includes(event.data.status)) return;
      isMatchGenuinelyActive(event.data)
        .then((genuinelyActive) => {
          if (genuinelyActive && event.data.id !== dismissedMatchIdRef.current) {
            if (event.data.status === "preparing") handleMatchAccepted(event.data.id);
            else setMyMatchId(event.data.id);
            setActiveMatch(event.data);
          }
        })
        .catch(() => {});
    });
    return () => unsubscribe();
  }, [user?.id, handleMatchAccepted]);

  // Polling safety net for the "searching → preparing" transition. Realtime is
  // the primary path; this lower-frequency visible-tab check recovers a dropped
  // event without issuing continuous reads from background tabs. Focus,
  // visibility, and connectivity changes trigger an immediate recovery check.
  useEffect(() => {
    if (!user?.id || myMatchId) return;
    let requestInFlight = false;
    const poll = async () => {
      if (document.visibilityState !== "visible" || requestInFlight) return;
      requestInFlight = true;
      try {
        const [asP1, asP2] = await Promise.all([
          base44.entities.Match.filter({ player1_id: user.id }, "-created_date", 5),
          base44.entities.Match.filter({ player2_id: user.id }, "-created_date", 5),
        ]);
        const candidate = [...asP1, ...asP2].find(
          (m) =>
            ["preparing", "both_ready", "in_progress"].includes(m.status) &&
            m.id !== dismissedMatchIdRef.current
        );
        if (!candidate) return;
        let genuinelyActive = true;
        if (candidate.status === "in_progress") {
          const games = await base44.entities.Game.filter({ match_id: candidate.id }, "-created_date", 1);
          genuinelyActive = games[0]?.status !== "completed";
        }
        if (genuinelyActive && candidate.id !== dismissedMatchIdRef.current) {
          if (candidate.status === "preparing") handleMatchAccepted(candidate.id);
          else setMyMatchId(candidate.id);
          setActiveMatch(candidate);
        }
      } catch {
        // Transient recovery failures are retried on the next visible interval.
      } finally {
        requestInFlight = false;
      }
    };
    poll();
    const interval = setInterval(poll, 20_000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("focus", poll);
    window.addEventListener("online", poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("focus", poll);
      window.removeEventListener("online", poll);
    };
  }, [user?.id, myMatchId, handleMatchAccepted]);

  // Recovery fetch for the active match — covers paths that set myMatchId
  // without already having the full record (e.g. accepting a match from
  // MatchCenter), plus the initial load. Only fires when needed, never polls.
  useEffect(() => {
    if (!myMatchId) return;
    if (activeMatch?.id === myMatchId) return;
    base44.entities.Match.get(myMatchId).then(setActiveMatch);
  }, [myMatchId, activeMatch?.id]);

  const handleRefreshActiveMatch = async () => {
    if (!myMatchId) return;
    const m = await base44.entities.Match.get(myMatchId);
    setActiveMatch(m);
  };

  const refreshWallet = useCallback(async () => {
    if (!user?.id) return null;
    const wallets = await base44.entities.Wallet.filter({ user_id: user.id });
    const currentWallet = wallets[0] || null;
    if (currentWallet) setWallet(currentWallet);
    return currentWallet;
  }, [user?.id]);

  // Settlement writes the authoritative Wallet before it marks the Match
  // completed. Refresh as soon as that terminal status arrives so the result
  // screen and marketplace share the newly settled balance.
  useEffect(() => {
    if (!activeMatch?.id || activeMatch.status !== "completed" || !user?.id) return;
    if (settledWalletRefreshRef.current === activeMatch.id) return;
    settledWalletRefreshRef.current = activeMatch.id;
    refreshWallet().catch(() => {
      // Allow the Return action below to retry a transient failed read.
      if (settledWalletRefreshRef.current === activeMatch.id) {
        settledWalletRefreshRef.current = null;
      }
    });
  }, [activeMatch?.id, activeMatch?.status, user?.id, refreshWallet]);

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      setUser(me);
      setMovementMode(me.movement_mode === "click" ? "click" : "drag");
      const soundsOn = me.sound_enabled == null ? getStoredSoundPreference() : me.sound_enabled !== false;
      soundEnabledRef.current = soundsOn;
      setSoundEnabled(soundsOn);
      storeSoundPreference(soundsOn);
      // Ensures a Wallet exists and, while Early Access Mode is on, grants the
      // one-time $500 bonus balance (recorded as a real WalletTransaction so
      // it shows in the user's transaction history) — see
      // base44/functions/grantEarlyAccessFunds and base44/shared/earlyAccess.ts.
      const { data } = await base44.functions.invoke("grantEarlyAccessFunds", {});
      setWallet(data.wallet);
      // Event tracking for monitoring $500 Early Access credit promotion usage.
      if (data.newly_credited) {
        base44.analytics.track({ eventName: "early_access_credit_granted", properties: { amount: 500 } });
        trackPixelEvent("Early Access Credit Granted", { value: 500, currency: "USD" });
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!game?.id) {
      moveSoundStateRef.current = { gameId: null, moveCount: 0 };
      return;
    }
    const moveCount = Array.isArray(game.move_log) ? game.move_log.length : 0;
    if (moveSoundStateRef.current.gameId !== game.id) {
      moveSoundStateRef.current = { gameId: game.id, moveCount };
      return;
    }
    if (moveCount > moveSoundStateRef.current.moveCount) {
      const lastMove = game.move_log[moveCount - 1];
      const myColor = activeMatch?.player1_id === user?.id ? "w" : "b";
      playGameSound(getMoveSoundCue(lastMove, myColor), soundEnabledRef.current);
    }
    moveSoundStateRef.current.moveCount = Math.max(moveSoundStateRef.current.moveCount, moveCount);
  }, [game?.id, game?.move_log?.length, activeMatch?.player1_id, user?.id]);

  useEffect(() => {
    if (!activeMatch?.id || activeMatch.status !== "completed" || !user?.id) return;
    const storageKey = "chessbet_result_sound_match_id";
    if (sessionStorage.getItem(storageKey) === activeMatch.id) return;
    sessionStorage.setItem(storageKey, activeMatch.id);
    const cue = activeMatch.result === "draw"
      ? "draw"
      : activeMatch.winner_id === user.id
        ? "victory"
        : "defeat";
    playGameSound(cue, soundEnabledRef.current);
  }, [activeMatch?.id, activeMatch?.status, activeMatch?.result, activeMatch?.winner_id, user?.id]);

  return (
    <div className="min-h-screen px-5 pt-6 lg:h-screen lg:overflow-hidden lg:flex lg:flex-col lg:pb-24">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 lg:mb-4 lg:shrink-0"
      >
        <div className="flex items-center justify-between">
          <Logo size="sm" />
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-0.5">Balance</p>
            <p className="text-lg font-bold text-[#C9A84C]">
              ${wallet?.balance?.toFixed(2) || "0.00"}
            </p>
          </div>
        </div>
        <DemoModeNotice />
        <div className="mt-3">
          <RestrictedModeBanner />
        </div>
      </motion.div>

      {/* Main Layout */}
      <div className="flex flex-col lg:flex-row gap-6 max-w-6xl mx-auto lg:flex-1 lg:min-h-0 w-full lg:items-stretch">
        {/* Board */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="lg:w-[62%] w-full lg:h-full lg:flex lg:flex-col lg:items-center lg:justify-center gap-3"
        >
          <ChessboardPreview
            state={boardState}
            fen={gameActive ? fen : undefined}
            onPieceDrop={isLive && movementMode === "drag" ? handleDrop : undefined}
            onSquareClick={isLive && movementMode === "click" ? handleSquareClick : undefined}
            selectedSquare={isLive && movementMode === "click" ? selectedSquare : null}
            legalTargets={isLive && movementMode === "click" ? legalTargets : []}
            boardOrientation={orientation}
            arePiecesDraggable={isLive && movementMode === "drag"}
          />
        </motion.div>

        {/* Match Center */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:w-[38%] w-full lg:h-full lg:min-h-0"
        >
          {myMatchId ? (
            <MatchView
              key={myMatchId}
              matchId={myMatchId}
              userId={user?.id}
              onExit={async () => {
                const exitingMatchId = myMatchId;
                try {
                  // Re-read before leaving the result/cancellation state so
                  // the marketplace never opens with a pre-settlement balance.
                  await refreshWallet();
                } catch {
                  // Navigation must remain available during a transient read failure.
                } finally {
                  dismissedMatchIdRef.current = exitingMatchId;
                  sessionStorage.setItem("chessbet_dismissed_match_id", exitingMatchId);
                  setMyMatchId(null);
                  setActiveMatch(null);
                  setBoardState("marketplace");
                }
              }}
              onStateChange={setBoardState}
              game={game}
              match={activeMatch}
              onRefresh={handleRefreshActiveMatch}
              movementMode={movementMode}
              onMovementModeChange={handleMovementModeChange}
              soundEnabled={soundEnabled}
              onSoundEnabledChange={handleSoundEnabledChange}
            />
          ) : (
            <MatchCenter
              userId={user?.id}
              balance={wallet?.balance || 0}
              onMatchAccepted={handleMatchAccepted}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
}