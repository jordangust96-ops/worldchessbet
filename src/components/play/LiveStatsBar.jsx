import React, { useState, useEffect, useCallback, useRef } from "react";
import { Users, Swords, ListChecks } from "lucide-react";
import { base44 } from "@/api/base44Client";

const REFRESH_INTERVAL_MS = 15000;
const RELEVANT_MATCH_STATUSES = new Set(["searching", "preparing", "both_ready", "in_progress", "completed", "cancelled"]);
const RELEVANT_GAME_STATUSES = new Set(["active", "completed", "abandoned"]);

// Thin, subtle stats strip shown above the match list — read-only and purely
// informational. It preserves its height while loading to avoid layout shifts.
export default function LiveStatsBar() {
  const [stats, setStats] = useState(null);
  const [isStale, setIsStale] = useState(false);
  const requestInFlight = useRef(false);

  const fetchStats = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const { data } = await base44.functions.invoke("getLiveStats", {});
      if (!data || data.error) throw new Error(data?.error || "Unable to load activity");
      setStats(data);
      setIsStale(false);
    } catch {
      // Keep the last known values visible instead of flashing or collapsing
      // the strip during a brief network interruption.
      setIsStale(true);
    } finally {
      requestInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    fetchStats();

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchStats();
    }, REFRESH_INTERVAL_MS);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") fetchStats();
    };
    const unsubscribeMatches = base44.entities.Match.subscribe((event) => {
      if (
        (event.type === "create" || event.type === "update") &&
        RELEVANT_MATCH_STATUSES.has(event.data?.status)
      ) {
        fetchStats();
      }
    });
    const unsubscribeGames = base44.entities.Game.subscribe((event) => {
      if (
        (event.type === "create" || event.type === "update") &&
        RELEVANT_GAME_STATUSES.has(event.data?.status)
      ) {
        fetchStats();
      }
    });

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      clearInterval(interval);
      unsubscribeMatches();
      unsubscribeGames();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [fetchStats]);

  const onlineWindow = stats?.onlineWindowSeconds || 120;
  const items = [
    {
      icon: Users,
      value: stats?.playersOnline,
      label: "Online",
      help: `Players active in ChessBet within the last ${Math.round(onlineWindow / 60)} minutes`,
    },
    {
      icon: Swords,
      value: stats?.matchesLive,
      label: "Live games",
      help: "Games with an active server record and a running authoritative clock",
    },
    {
      icon: ListChecks,
      value: stats?.availableMatches,
      label: "Challenges",
      help: "Public challenges available for you to accept",
    },
  ];

  const updatedLabel = stats?.generatedAt
    ? `Updated ${new Date(stats.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
    : "Loading live marketplace activity";

  return (
    <div
      className="relative flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2 mb-4 lg:mb-2"
      aria-label={`Marketplace activity. ${isStale ? "Values may be out of date." : updatedLabel}`}
      aria-busy={!stats}
      title={isStale ? "Unable to refresh — showing the last known activity" : updatedLabel}
    >
      {items.map(({ icon: Icon, value, label, help }) => (
        <div key={label} className="flex items-center gap-1.5 min-w-0" title={help}>
          <Icon size={12} className="text-[#C9A84C]/70 shrink-0" aria-hidden="true" />
          <span className="text-xs font-bold text-white shrink-0 tabular-nums">
            {Number.isFinite(value) ? value.toLocaleString() : "—"}
          </span>
          <span className="text-[10px] text-white/30 truncate">{label}</span>
        </div>
      ))}
      {isStale && stats && (
        <span
          className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-[#161616]"
          aria-label="Activity refresh delayed"
        />
      )}
    </div>
  );
}