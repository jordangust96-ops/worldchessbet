import React, { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import MatchAcceptedState from "@/components/play/matchview/MatchAcceptedState";
import DepositWaitingState from "@/components/play/matchview/DepositWaitingState";
import BothReadyState from "@/components/play/matchview/BothReadyState";
import InProgressState from "@/components/play/matchview/InProgressState";
import SettlementState from "@/components/play/matchview/SettlementState";

export default function MatchView({ matchId, userId, onExit, onStateChange }) {
  const [match, setMatch] = useState(null);
  const [launched, setLaunched] = useState(false);

  const refresh = useCallback(async () => {
    const m = await base44.entities.Match.get(matchId);
    setMatch(m);
  }, [matchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const poll = setInterval(refresh, 2000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    if (match?.status === "cancelled") {
      onExit();
    }
  }, [match?.status, onExit]);

  const handleCancel = async () => {
    await base44.entities.Match.update(matchId, { status: "cancelled" });
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
    } else if (match.status === "in_progress" && launched) {
      stateKey = "in_progress";
      content = <InProgressState match={match} userId={userId} onSubmitted={refresh} />;
    } else if (match.status === "in_progress" && !launched) {
      stateKey = "both_ready";
      content = <BothReadyState match={match} onLaunch={() => setLaunched(true)} />;
    } else if (myDeposited && !opponentDeposited) {
      stateKey = "deposit_waiting";
      content = <DepositWaitingState match={match} />;
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
          onCancel={handleCancel}
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