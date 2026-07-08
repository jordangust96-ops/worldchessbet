import React, { useState, useEffect, useCallback } from "react";
import AvailableMatchSection from "@/components/play/AvailableMatchSection";
import HostMatchSection from "@/components/play/HostMatchSection";
import ActiveChallengeCard from "@/components/play/ActiveChallengeCard";
import { base44 } from "@/api/base44Client";

export default function MatchCenter({ userId, balance }) {
  const [activeMatch, setActiveMatch] = useState(null);

  const refreshActiveMatch = useCallback(async () => {
    if (!userId) return;
    const mine = await base44.entities.Match.filter({ player1_id: userId }, "-created_date", 5);
    const active = mine.find((m) => m.status === "searching" || m.status === "matched");
    setActiveMatch(active || null);
  }, [userId]);

  useEffect(() => {
    refreshActiveMatch();
  }, [refreshActiveMatch]);

  useEffect(() => {
    if (!activeMatch) return;
    const poll = setInterval(refreshActiveMatch, 2500);
    return () => clearInterval(poll);
  }, [activeMatch?.id, activeMatch?.status, refreshActiveMatch]);

  const handleCancel = async () => {
    if (!activeMatch) return;
    await base44.entities.Match.update(activeMatch.id, { status: "cancelled" });
    setActiveMatch(null);
  };

  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6 lg:p-5 lg:h-full lg:overflow-y-auto lg:flex lg:flex-col lg:justify-center space-y-5 lg:space-y-3">
      <ActiveChallengeCard match={activeMatch} onCancel={handleCancel} />

      <div className="h-px bg-white/[0.06]" />

      <AvailableMatchSection
        userId={userId}
        activeMatch={activeMatch}
        onChallengeCancelled={() => setActiveMatch(null)}
      />

      <div className="h-px bg-white/[0.06]" />

      <HostMatchSection userId={userId} balance={balance} onHosted={setActiveMatch} disabled={!!activeMatch} />
    </div>
  );
}