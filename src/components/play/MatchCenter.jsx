import React, { useState, useEffect, useCallback } from "react";
import AvailableMatchSection from "@/components/play/AvailableMatchSection";
import HostMatchSection from "@/components/play/HostMatchSection";
import ActiveChallengeCard from "@/components/play/ActiveChallengeCard";
import PrivateWaitingCard from "@/components/play/PrivateWaitingCard";
import { base44 } from "@/api/base44Client";

export default function MatchCenter({ userId, balance, onMatchAccepted }) {
  const [activeMatch, setActiveMatch] = useState(null);

  const refreshActiveMatch = useCallback(async () => {
    if (!userId) return;
    const mine = await base44.entities.Match.filter({ player1_id: userId }, "-created_date", 5);
    const active = mine.find((m) => m.status === "searching" || m.status === "matched");
    setActiveMatch(active || null);
    if (active?.status === "matched") {
      onMatchAccepted?.(active.id);
    }
  }, [userId, onMatchAccepted]);

  useEffect(() => {
    // One-time fetch to recover the authoritative state on mount or reconnect.
    refreshActiveMatch();
  }, [refreshActiveMatch]);

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = base44.entities.Match.subscribe((event) => {
      if (event.data?.player1_id !== userId) return;
      if (event.type === "update" || event.type === "create") {
        if (event.data.status === "searching" || event.data.status === "matched") {
          setActiveMatch(event.data);
          if (event.data.status === "matched") {
            onMatchAccepted?.(event.data.id);
          }
        } else if (activeMatch?.id === event.data.id) {
          setActiveMatch(null);
        }
      }
    });
    return () => unsubscribe();
  }, [userId, activeMatch?.id, onMatchAccepted]);

  const handleCancel = async () => {
    if (!activeMatch) return;
    await base44.entities.Match.update(activeMatch.id, { status: "cancelled" });
    setActiveMatch(null);
  };

  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6 lg:p-4 lg:h-full lg:overflow-y-auto lg:flex lg:flex-col lg:justify-start space-y-5 lg:space-y-2.5">
      <AvailableMatchSection
        userId={userId}
        balance={balance}
        activeMatch={activeMatch}
        onChallengeCancelled={() => setActiveMatch(null)}
        onAccepted={onMatchAccepted}
      />

      <div className="h-px bg-white/[0.06] shrink-0" />

      {activeMatch ? (
        activeMatch.is_private ? (
          <PrivateWaitingCard match={activeMatch} onCancel={handleCancel} />
        ) : (
          <ActiveChallengeCard match={activeMatch} onCancel={handleCancel} />
        )
      ) : (
        <HostMatchSection userId={userId} balance={balance} onHosted={setActiveMatch} />
      )}
    </div>
  );
}