import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Crown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import ChessboardPreview from "@/components/play/ChessboardPreview";
import MatchCenter from "@/components/play/MatchCenter";
import MatchView from "@/components/play/MatchView";
import PlayerClocks from "@/components/play/PlayerClocks";
import { useChessGame } from "@/hooks/useChessGame";

export default function Home() {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [myMatchId, setMyMatchId] = useState(null);
  const [boardState, setBoardState] = useState("marketplace");
  // Tracks the last match the player explicitly dismissed (via "Find New Match"),
  // so a lagging realtime update for that same completed match never restores it.
  const dismissedMatchIdRef = useRef(null);
  const gameActive = boardState === "both_ready" || boardState === "in_progress" || boardState === "game_summary";
  const isLive = boardState === "in_progress";
  const { fen, handleDrop, orientation, game } = useChessGame(myMatchId, user?.id, gameActive);

  useEffect(() => {
    if (!user?.id) return;

    const checkActiveMatch = async () => {
      const asP1 = await base44.entities.Match.filter({ player1_id: user.id }, "-created_date", 5);
      const asP2 = await base44.entities.Match.filter({ player2_id: user.id }, "-created_date", 5);
      const candidates = [...asP1, ...asP2].filter((m) =>
        ["matched", "deposited", "in_progress"].includes(m.status)
      );
      for (const m of candidates) {
        if (m.status === "in_progress") {
          // A match can stay "in_progress" for a moment after the game itself has
          // finished, while settlement is pending. Don't restore the Match View
          // (and its post-game summary) for those — treat it as no active match.
          const games = await base44.entities.Game.filter({ match_id: m.id }, "-created_date", 1);
          if (games[0]?.status === "completed") continue;
        }
        setMyMatchId(m.id);
        return;
      }
    };
    // One-time fetch to recover the authoritative state on mount or reconnect.
    checkActiveMatch();

    const unsubscribe = base44.entities.Match.subscribe((event) => {
      if (event.data?.player1_id !== user.id && event.data?.player2_id !== user.id) return;
      if (event.type !== "update" && event.type !== "create") return;
      // Never restore a match the player already dismissed via Find New Match.
      if (event.data.id === dismissedMatchIdRef.current) return;
      if (["matched", "deposited", "in_progress"].includes(event.data.status)) {
        setMyMatchId(event.data.id);
      }
    });
    return () => unsubscribe();
  }, [user?.id]);

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      setUser(me);
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
        className="flex items-center justify-between mb-6 lg:mb-4 lg:shrink-0"
      >
        <div className="flex items-center gap-2">
          <Crown size={18} strokeWidth={1.5} className="text-[#C9A84C]" />
          <span className="text-sm font-bold tracking-tight gold-text">
            ChessBet
          </span>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-white/40 mb-0.5">Balance</p>
          <p className="text-lg font-bold text-[#C9A84C]">
            ${wallet?.balance?.toFixed(2) || "0.00"}
          </p>
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
          {isLive && <PlayerClocks game={game} orientation={orientation} />}
          <ChessboardPreview
            state={boardState}
            fen={gameActive ? fen : undefined}
            onPieceDrop={isLive ? handleDrop : undefined}
            boardOrientation={orientation}
            arePiecesDraggable={isLive}
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
                setMyMatchId(null);
                setBoardState("marketplace");
              }}
              onStateChange={setBoardState}
              game={game}
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