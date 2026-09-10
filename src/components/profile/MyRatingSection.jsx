import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { BarChart3, CheckCircle2, Check } from "lucide-react";

const POOLS = ["blitz", "rapid", "classical"];
const LABELS = { blitz: "Blitz", rapid: "Rapid", classical: "Classical" };
const STATUS = {
  coming_soon: "Temporarily unavailable", unavailable: "Temporarily unavailable",
  updating: "Updating", unrated: "Unrated",
  provisional: "Provisional", established: "Established",
};

export default function MyRatingSection({ onSummaryChange }) {
  const [pool, setPool] = useState("blitz");
  const [cursor, setCursor] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const autoSelectedRef = useRef(false);
  const userSelectedRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setData(null);
    // This request owns its loading/error state; it cannot block profile actions.
    const timer = setTimeout(() => {
      if (active) {
        active = false;
        setLoading(false);
        setError(true);
      }
    }, 15000);
    base44.functions.invoke("getMyRating", {
      time_control: pool,
      ...(cursor ? { before_game: cursor.before, generation: cursor.generation } : {}),
    }).then((response) => {
      if (!active) return;
      const result = response.data;
      if (!result || !Array.isArray(result.pools)) throw new Error("Invalid rating response");
      setData(result);
      // Default the view to whichever time control the player has made the most
      // progress in, unless they've already picked one themselves. Runs once.
      if (!autoSelectedRef.current && !userSelectedRef.current) {
        autoSelectedRef.current = true;
        const mostProgressed = [...POOLS].sort((a, b) => {
          const gamesA = result.pools.find((entry) => entry.time_control === a)?.games_rated || 0;
          const gamesB = result.pools.find((entry) => entry.time_control === b)?.games_rated || 0;
          return gamesB - gamesA;
        })[0];
        if (mostProgressed && mostProgressed !== pool) setPool(mostProgressed);
      }
    }).catch(() => {
      if (active) setError(true);
    }).finally(() => {
      if (active) {
        clearTimeout(timer);
        setLoading(false);
      }
    });
    return () => { active = false; clearTimeout(timer); };
  }, [pool, cursor, attempt]);

  const threshold = data?.provisional_games || 10;
  const selected = data?.pools?.find((item) => item.time_control === pool);
  const history = data?.history?.time_control === pool ? data.history : null;
  const refresh = () => { setCursor(null); setAttempt((value) => value + 1); };
  const remaining = threshold - (selected?.games_rated || 0);
  const gamesCompleted = Math.max(0, Math.min(threshold, selected?.games_rated || 0));

  // Report the currently-viewed pool's summary up to the profile page so its
  // hero rating card can mirror this selection without a second data fetch.
  useEffect(() => {
    onSummaryChange?.({
      pool,
      loading,
      error,
      status: selected?.status,
      rating: selected?.rating ?? null,
      gamesRated: selected?.games_rated ?? 0,
      threshold,
    });
  }, [onSummaryChange, pool, loading, error, selected, threshold]);

  return (
    <section aria-labelledby="my-rating-title" className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 size={18} className="text-[#C9A84C]" aria-hidden="true" />
        <h2 id="my-rating-title" className="text-base font-bold text-white">My Rating</h2>
      </div>
      <p className="text-sm text-white/60">
        Your skill rating in Blitz, Rapid, and Classical — tracked separately for each.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {POOLS.map((timeControl) => {
          const item = data?.pools?.find((entry) => entry.time_control === timeControl);
          const pct = item?.games_rated != null ? Math.min(100, Math.round((item.games_rated / threshold) * 100)) : 0;
          return (
            <button key={timeControl} type="button" aria-pressed={pool === timeControl}
              onClick={() => { userSelectedRef.current = true; autoSelectedRef.current = true; setPool(timeControl); setCursor(null); }}
              className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A84C] ${pool === timeControl ? "border-[#C9A84C]/50 bg-[#C9A84C]/10" : "border-white/10 bg-white/[0.02]"}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="block text-sm font-semibold text-white">{LABELS[timeControl]}</span>
                {item?.status === "established" && <CheckCircle2 size={14} className="text-[#C9A84C]" aria-hidden="true" />}
              </div>
              {typeof item?.rating === "number" && <span className="block mt-1 text-xl font-bold text-[#C9A84C]">{item.rating}</span>}
              <span className="block mt-1 text-xs text-white/60">
                {loading ? "Loading…" : error ? "Unavailable" : STATUS[item?.status] || "Temporarily unavailable"}
              </span>
              {!loading && !error && typeof item?.games_rated === "number" && (
                <div className="mt-2 space-y-1">
                  <span className="block text-[11px] text-white/50">
                    {item.status === "provisional" ? `${item.games_rated}/${threshold} games` : `${item.games_rated} rated games`}
                  </span>
                  {item.status === "provisional" && (
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full bg-[#C9A84C] transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" aria-busy={loading} className="text-sm text-white/60">
        {loading ? <p>Loading your rating status…</p> : error ? (
          <div className="space-y-2">
            <p>We couldn't load your ratings. You can still use your profile as usual.</p>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>Try again</Button>
          </div>
        ) : data?.status === "coming_soon" ? (
          <p>Ratings are temporarily unavailable. Check back soon.</p>
        ) : data?.status === "unavailable" ? (
          <p>Rating status is temporarily unavailable. Check back soon.</p>
        ) : data?.status === "updating" || selected?.status === "updating" ? (
          <div className="space-y-2">
            <p>Your rating's being recalculated. Check back shortly.</p>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>Check again</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {data?.status === "paused" && <p>New ratings are paused right now — showing your last confirmed number.</p>}
            {selected?.status === "unrated" && <p>No rated {LABELS[pool]} games yet. Play {threshold} confirmed games to establish your rating.</p>}
            {selected?.status === "provisional" && (
              <p>You're warming up: {selected.games_rated} of {threshold} confirmed {LABELS[pool]} games played. {remaining} more and your rating goes official.</p>
            )}
            {(selected?.status === "unrated" || selected?.status === "provisional") && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5" role="img" aria-label={`${gamesCompleted} of ${threshold} confirmed ${LABELS[pool]} games completed`}>
                  {Array.from({ length: threshold }, (_, index) => index + 1).map((gameNumber) => {
                    const done = gameNumber <= gamesCompleted;
                    return (
                      <div key={gameNumber} aria-hidden="true"
                        className={`w-7 h-7 rounded-md border flex items-center justify-center text-[10px] font-bold transition-colors ${done ? "bg-[#C9A84C]/20 border-[#C9A84C]/50 text-[#C9A84C]" : "border-white/15 text-white/30"}`}>
                        {done ? <Check size={12} /> : gameNumber}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-white/40">{gamesCompleted} of {threshold} games completed.</p>
              </div>
            )}
            {selected?.status === "established" && !history?.entries?.length && (
              <p>Your {LABELS[pool]} rating is established and updates after every confirmed game.</p>
            )}
            {history?.entries?.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">{LABELS[pool]} rating history</h3>
                <p className="text-xs text-white/50">Newest first.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">{LABELS[pool]} rating changes by rated game</caption>
                    <thead className="text-white/50"><tr>
                      <th className="py-2 pr-3" scope="col">Game / date</th><th className="pr-3" scope="col">Result</th>
                      <th className="pr-3" scope="col">Rating</th><th scope="col">Change</th>
                    </tr></thead>
                    <tbody>{history.entries.map((entry) => (
                      <tr key={entry.game_number} className="border-t border-white/5">
                        <td className="py-2 pr-3">#{entry.game_number} · {new Date(entry.date).toLocaleDateString()}</td>
                        <td className="pr-3">{entry.result}</td><td className="pr-3 text-white">{entry.rating}</td>
                        <td className={entry.change > 0 ? "text-emerald-400" : entry.change < 0 ? "text-red-400" : ""}>{entry.change > 0 ? "+" : ""}{entry.change}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-2">
                  {cursor && <Button type="button" variant="outline" size="sm" onClick={() => setCursor(null)}>Newest games</Button>}
                  {history.next_before_game != null && <Button type="button" variant="outline" size="sm"
                    onClick={() => setCursor({ before: history.next_before_game, generation: data.generation })}>Older games</Button>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <details className="border-t border-white/10 pt-3">
        <summary className="cursor-pointer text-sm font-medium text-[#C9A84C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A84C]">How ratings work</summary>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/60">
          <p>We use Glicko-2, a rating system that weighs who you played, not just wins and losses.</p>

          {selected?.status === "established" && (
            <div className="space-y-1.5">
              <p className="text-white">
                Your {LABELS[pool]} rating: <span className="font-bold text-[#C9A84C]">{selected.rating}</span>
              </p>
              <p>It's established, so it now recalculates after every confirmed game instead of building toward a first number.</p>
            </div>
          )}

          <p>Games are scored once the 24-hour reporting window and any reviews wrap up — that's the short delay you'll sometimes see.</p>
        </div>
      </details>
    </section>
  );
}
