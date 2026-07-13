import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import MatchAcceptedState from "@/components/play/matchview/MatchAcceptedState";
import DepositWaitingState from "@/components/play/matchview/DepositWaitingState";
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

  useEffect(() => {
    if (match?.status === "cancelled" && !cancelHandledRef.current) {
      cancelHandledRef.current = true;
      if (!selfCancelledRef.current) {
        toast({
          title: "Match Cancelled",
          description: "Your opponent cancelled the match. Any escrowed funds have been returned to your wallet.",
        });
      }
      onExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.status]);

  // Cancelling a pending match must release escrow back to whichever player(s)
  // already deposited — the canceling user, the opponent, or neither. The
  // wallet refund + status update happen server-side (cancelMatch) since the
  // Wallet entity can no longer be written to directly from the client.
  const handleCancel = async (matchToCancel) => {
    selfCancelledRef.current = true;
    await base44.functions.invoke("cancelMatch", { matchId: matchToCancel.id });
  };

  const isActive = match && match.status !== "cancelled";
  const isP1 = isActive && match.player1_id === userId;
  const myDeposited = isActive && (isP1 ? match.player1_deposited : match.player2_deposited);
  const opponentDeposited = isActive && (isP1 ? match.player2_deposited : match.player1_deposited);
  const opponentId = isActive ? (isP1 ? match.player2_id : match.player1_id) : null;

  let stateKey = "marketplace";
  let content = null;

  if (isActive) {
    if (match.status === "completed") {
      stateKey = "settlement";
      content = <SettlementState match={match} userId={userId} onReturn={onExit} />;
    } else if (game?.status === "completed") {
      stateKey = "game_summary";
      content = <GameSummary match={match} game={game} userId={userId} onPlayAgain={onExit} />;
    } else if (match.status === "in_progress") {
      // Board becomes interactive immediately once both players have deposited —
      // no manual "Launch" step required, which previously could strand a
      // player on the Both Ready screen and make it look like they couldn't move.
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
    } else if (myDeposited && !opponentDeposited) {
      stateKey = "deposit_waiting";
      content = <DepositWaitingState match={match} onCancel={() => handleCancel(match)} />;
    } else {
      stateKey = "accepted";
      content = (
        <MatchAcceptedState
          match={match}
          userId={userId}
          opponentId={opponentId}
          myDeposited={myDeposited}
          opponentDeposited={opponentDeposited}
          onDeposited={onRefresh}
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