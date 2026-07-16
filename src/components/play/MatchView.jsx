import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import PreparingMatchScreen from "@/components/play/matchview/PreparingMatchScreen";
import MatchStartCountdown from "@/components/play/matchview/MatchStartCountdown";
import GameHUD from "@/components/play/matchview/GameHUD";
import GameSummary from "@/components/play/matchview/GameSummary";
import SettlementState from "@/components/play/matchview/SettlementState";

// Match data is sourced entirely from the parent (Home), which owns the single
// authoritative Match subscription for the active match — this component no
// longer opens its own duplicate subscription/fetch for the same record.
export default function MatchView({
  matchId,
  userId,
  onExit,
  onStateChange,
  game,
  match,
  onRefresh,
  movementMode,
  onMovementModeChange,
}) {
  const { toast } = useToast();
  // Tracks whether this client is the one who initiated the cancellation, so the
  // "opponent cancelled" notification only surfaces for the other player.
  const selfCancelledRef = useRef(false);
  // Ensures the cancellation toast + exit fire exactly once per match, even if
  // this effect re-runs due to parent re-renders passing a new onExit/toast reference.
  const cancelHandledRef = useRef(false);
  // The 3-second "Match Starting" ceremony is shown exactly once per match,
  // the first time it reaches in_progress.
  const [countdownDone, setCountdownDone] = useState(false);

  useEffect(() => {
    if (match?.status === "cancelled" && !cancelHandledRef.current) {
      cancelHandledRef.current = true;
      if (!selfCancelledRef.current) {
        toast({
          title: "Match Cancelled",
          description: "This match was cancelled. Any reserved funds have been returned to your wallet.",
        });
      }
      onExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.status]);

  // Cancelling a pending match must release escrow back to whichever player(s)
  // already reserved funds — the canceling user, the opponent, or neither. The
  // wallet refund + status update happen server-side (cancelMatch) since the
  // Wallet entity can no longer be written to directly from the client.
  const handleCancel = async (matchToCancel) => {
    selfCancelledRef.current = true;
    await base44.functions.invoke("cancelMatch", { matchId: matchToCancel.id });
  };

  const isActive = match && match.status !== "cancelled";
  const isP1 = isActive && match.player1_id === userId;
  const opponentId = isActive ? (isP1 ? match.player2_id : match.player1_id) : null;

  let stateKey = "marketplace";
  let content = null;

  if (isActive) {
    if (game?.status === "completed" && match.status === "completed") {
      stateKey = "settlement";
      content = <SettlementState match={match} game={game} userId={userId} onReturn={onExit} />;
    } else if (game?.status === "completed") {
      stateKey = "game_summary";
      content = <GameSummary match={match} game={game} userId={userId} onPlayAgain={onExit} />;
    } else if (match.status === "in_progress") {
      if (!countdownDone) {
        stateKey = "countdown";
        content = <MatchStartCountdown onDone={() => setCountdownDone(true)} />;
      } else {
        stateKey = "in_progress";
        content = (
          <GameHUD
            match={match}
            userId={userId}
            game={game}
            movementMode={movementMode}
            onMovementModeChange={onMovementModeChange}
          />
        );
      }
    } else if (match.status === "preparing" || match.status === "both_ready") {
      // Both players independently certify Fair Play and reserve their Entry
      // Amount here — identical screen and identical actions for host and
      // joiner alike, for both public and private matches.
      stateKey = "preparing";
      content = (
        <PreparingMatchScreen
          match={match}
          userId={userId}
          opponentId={opponentId}
          onCancel={() => handleCancel(match)}
        />
      );
    }
  }

  useEffect(() => {
    onStateChange?.(stateKey);
  }, [stateKey, onStateChange]);

  if (!isActive) {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6 lg:p-4 lg:h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C9A84C]" size={22} />
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6 lg:p-4 lg:h-full lg:overflow-y-auto">
      <AnimatePresence mode="wait">
        <motion.div
          key={stateKey}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}