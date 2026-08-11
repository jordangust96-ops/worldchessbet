import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { base44 } from "@/api/base44Client";

// Shared "Notify me when this match is accepted" control — used identically
// by both the public (ActiveChallengeCard) and private (PrivateWaitingCard)
// waiting states, so the preference behaves the same regardless of match type.
export default function NotifyOnAcceptToggle({ match }) {
  const [notifyOnAccept, setNotifyOnAccept] = useState(match?.notify_on_accept ?? true);

  useEffect(() => {
    setNotifyOnAccept(match?.notify_on_accept ?? true);
  }, [match?.id, match?.notify_on_accept]);

  const handleToggle = async (checked) => {
    const previous = notifyOnAccept;
    setNotifyOnAccept(checked);
    try {
      await base44.functions.invoke("updateMatchPreference", {
        matchId: match.id,
        notifyOnAccept: checked,
      });
    } catch {
      setNotifyOnAccept(previous);
    }
  };

  return (
    <div className="flex items-center justify-between pt-2 lg:pt-1 mt-1 border-t border-white/[0.06]">
      <p className="text-xs text-white/50 pr-3">Notify me when this match is accepted</p>
      <Switch checked={notifyOnAccept} onCheckedChange={handleToggle} />
    </div>
  );
}