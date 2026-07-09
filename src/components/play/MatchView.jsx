import React, { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import MatchAcceptedState from "@/components/play/matchview/MatchAcceptedState";
import DepositWaitingState from "@/components/play/matchview/DepositWaitingState";
import BothReadyState from "@/components/play/matchview/BothReadyState";
import GameHUD from "@/components/play/matchview/GameHUD";
import GameSummary from "@/components/play/matchview/GameSummary";
import SettlementState from "@/components/play/matchview/SettlementState";

export default function MatchView({ matchId, userId, onExit, onStateChange, game }) {
  const [match, setMatch] = useState(null);
  const [launched, setLaunched] = useState(false);
  const { toast } = useToast();
  // Tracks whether this client is the one who initiated the cancellation, so the
  // "opponent cancelled" notification only surfaces for the other player.
  const selfCancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    const m = await base44.entities.Match.get(matchId);
    setMatch(m);
  }, [matchId]);

  useEffect(() => {
    // One-time fetch to recover the authoritative state on mount, refresh, or reconnect.
    refresh();

    const unsubscribe = base44.entities.Match.subscribe((event) => {
      if (event.data?.id !== matchId) return;
      if (event.type === "update" || event.type === "create") {
        setMatch(event.data);
      }
    });
    return () => unsubscribe();
  }, [matchId, refresh]);

  useEffect(() => {
    if (match?.status === "cancelled") {
      if (!selfCancelledRef.current) {
        toast({
          title: "Match Cancelled",
          description: "Your opponent cancelled the match. Any escrowed funds have been returned to your wallet.",
        });
      }
      onExit();
    }
  }, [match?.status, onExit, toast]);

  // Cancelling a pending match must release escrow back to whichever player(s)
  // already deposited — the canceling user, the opponent, or neither.
  const handleCancel = async (matchToCancel) => {
    selfCancelledRef.current = true;
    const refundTargets = [];
    if (matchToCancel.player1_deposited) refundTargets.push(matchToCancel.player1_id);
    if (matchToCancel.player2_deposited) refundTargets.push(matchToCancel.player2_id);

    for (const depositorId of refundTargets) {
      const wallets = await base44.entities.Wallet.filter({ user_id: depositorId });
      if (wallets.length > 0) {
        const wallet = wallets[0];
        await base44.entities.Wallet.update(wallet.id, {
          balance: wallet.balance + matchToCancel.wager_amount,
          total_wagered: Math.max(0, (wallet.total_wagered || 0) - matchToCancel.wager_amount),
        });
        await base44.entities.WalletTransaction.create({
          user_id: depositorId,
          type: "wager_refund",
          amount: matchToCancel.wager_amount,
          match_id: matchToCancel.id,
          description: "Escrow refunded — match cancelled",
          status: "completed",
        });
      }
    }
    await base44.entities.Match.update(matchToCancel.id, { status: "cancelled" });
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
    } else if (match.status === "in_progress" && launched) {
      stateKey = "in_progress";
      content = <GameHUD match={match} userId={userId} game={game} />;
    } else if (match.status === "in_progress" && !launched) {
      stateKey = "both_ready";
      content = <BothReadyState match={match} onLaunch={() => setLaunched(true)} />;
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
          onDeposited={refresh}
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