import React, { useState, useEffect, useCallback } from "react";
import { Users, Swords, ListChecks } from "lucide-react";
import { base44 } from "@/api/base44Client";

const REFRESH_INTERVAL_MS = 15000;

// Thin, subtle stats strip shown above the match list — read-only, purely
// informational, never affects layout height or the marketplace flow below it.
export default function LiveStatsBar() {
  const [stats, setStats] = useState(null);

  const fetchStats = useCallback(async () => {
    const { data } = await base44.functions.invoke("getLiveStats", {});
    if (!data?.error) setStats(data);
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (!stats) return null;

  const items = [
    { icon: Users, value: stats.playersOnline, label: "Online" },
    { icon: Swords, value: stats.matchesLive, label: "Live" },
    { icon: ListChecks, value: stats.availableMatches, label: "Available" },
  ];

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2 mb-4 lg:mb-2">
      {items.map(({ icon: Icon, value, label }) => (
        <div key={label} className="flex items-center gap-1.5 min-w-0">
          <Icon size={12} className="text-[#C9A84C]/70 shrink-0" />
          <span className="text-xs font-bold text-white shrink-0">{value}</span>
          <span className="text-[10px] text-white/30 truncate">{label}</span>
        </div>
      ))}
    </div>
  );
}