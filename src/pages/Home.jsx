import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import Logo from "@/components/Logo";
import ChessboardPreview from "@/components/play/ChessboardPreview";
import MatchCenter from "@/components/play/MatchCenter";
import MatchView from "@/components/play/MatchView";
import PlayerClocks from "@/components/play/PlayerClocks";
import DemoModeNotice from "@/components/DemoModeNotice";
import { useChessGame } from "@/hooks/useChessGame";

export default function Home() {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
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
  const gameActive = boardState === "in_progress" || boardState === "game_summary";
  const isLive = boardState === "in_progress";
  const [movementMode, setMovementMode] = useState("drag");
  const { fen, handleDrop, handleSquareClick, selectedSquare, legalTargets, orientation, game } =
    useChessGame(myMatchId, user?.id, gameActive);

  const handleMovementModeChange = (mode) => {
    setMovementMode(mode);
    base44.auth.updateMe({ movement_mode: mode });
  };

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
        (m) => ["matched", "deposited", "in_progress"].includes(m.status) && m.id !== dismissedMatchIdRef.current
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
    checkActiveMatch();

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
      if (!["matched", "deposited", "in_progress"].includes(event.data.status)) return;
      isMatchGenuinelyActive(event.data).then((genuinelyActive) => {
        if (genuinelyActive && event.data.id !== dismissedMatchIdRef.current) {
          setMyMatchId(event.data.id);
          setActiveMatch(event.data);
        }
      });
    });
    return () => unsubscribe();
  }, [user?.id]);

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

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      setUser(me);
      setMovementMode(me.movement_mode === "click" ? "click" : "drag");
      const wallets = await base44.entities.Wallet.filter({ user_id: me.id });
      if (wallets.length > 0) {
        setWallet(wallets[0]);
      } else {
        const newWallet = await base44.entities.Wallet.create({
          user_id: me.id,
          balance: 0,
          total_wagered: 0,
          total_won: 0,
          total_deposited: 0,
          total_withdrawn: 0,
        });
        setWallet(newWallet);
      }
    };
    load();
  }, []);

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
      </motion.div>

      {/* Main Layout */}
      <div className="flex flex-col lg:flex-row gap-6 max-w-6xl mx-auto lg:flex-1 lg:min-h-0 w-full lg:items-stretch">
        {/* Board */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="lg:w-[62%] w-full lg:h-full lg:flex lg:flex-col lg:items-center lg:justify-center gap-3"
        >
          {isLive && <PlayerClocks game={game} orientation={orientation} />}
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
              onExit={() => {
                dismissedMatchIdRef.current = myMatchId;
                sessionStorage.setItem("chessbet_dismissed_match_id", myMatchId);
                setMyMatchId(null);
                setActiveMatch(null);
                setBoardState("marketplace");
              }}
              onStateChange={setBoardState}
              game={game}
              match={activeMatch}
              onRefresh={handleRefreshActiveMatch}
              movementMode={movementMode}
              onMovementModeChange={handleMovementModeChange}
            />
          ) : (
            <MatchCenter
              userId={user?.id}
              balance={wallet?.balance || 0}
              onMatchAccepted={(id) => setMyMatchId(id)}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
}