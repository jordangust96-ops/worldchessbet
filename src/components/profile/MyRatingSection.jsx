import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";

const POOLS = ["blitz", "rapid", "classical"];
const LABELS = { blitz: "Blitz", rapid: "Rapid", classical: "Classical" };
const STATUS = {
  coming_soon: "Coming soon", unavailable: "Temporarily unavailable",
  updating: "Updating", unrated: "Not yet rated",
  provisional: "Provisional", established: "Established",
};

export default function MyRatingSection() {
  const [pool, setPool] = useState("blitz");
  const [cursor, setCursor] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

  return (
    <section aria-labelledby="my-rating-title" className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 size={18} className="text-[#C9A84C]" aria-hidden="true" />
        <h2 id="my-rating-title" className="text-base font-bold text-white">My Rating</h2>
      </div>
      <p className="text-sm text-white/60">
        Your ChessBet skill rating, tracked separately for Blitz, Rapid, and Classical.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {POOLS.map((timeControl) => {
          const item = data?.pools?.find((entry) => entry.time_control === timeControl);
          return (
            <button key={timeControl} type="button" aria-pressed={pool === timeControl}
              onClick={() => { setPool(timeControl); setCursor(null); }}
              className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A84C] ${pool === timeControl ? "border-[#C9A84C]/50 bg-[#C9A84C]/10" : "border-white/10 bg-white/[0.02]"}`}>
              <span className="block text-sm font-semibold text-white">{LABELS[timeControl]}</span>
              {typeof item?.rating === "number" && <span className="block mt-1 text-xl font-bold text-[#C9A84C]">{item.rating}</span>}
              <span className="block mt-1 text-xs text-white/60">
                {loading ? "Loading…" : error ? "Unavailable" : STATUS[item?.status] || "Temporarily unavailable"}
              </span>
              {!loading && !error && typeof item?.games_rated === "number" && (
                <span className="block mt-1 text-xs text-white/50">
                  {item.status === "provisional" ? `${item.games_rated} of ${threshold} rated games` : `${item.games_rated} rated games`}
                </span>
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
          <p>Ratings are coming soon. Your rating and history will appear here when they're ready to share.</p>
        ) : data?.status === "unavailable" ? (
          <p>Rating status is temporarily unavailable. Please check again later.</p>
        ) : data?.status === "updating" || selected?.status === "updating" ? (
          <div className="space-y-2">
            <p>Your rating is being updated. Check back for your confirmed rating and history.</p>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>Check again</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {data?.status === "paused" && <p>New rating calculations are paused. Any rating shown is your last confirmed rating.</p>}
            {selected?.status === "unrated" && <p>No rated {LABELS[pool]} games yet. ChessBet is tracking eligible results toward your first provisional rating; confirmed results appear after the reporting window and any reviews are complete.</p>}
            {selected?.status === "provisional" && <p>Your {LABELS[pool]} rating is provisional while ChessBet builds it from your first {threshold} confirmed rated games. It becomes established when your {threshold}th game in this time control is rated.</p>}
            {history?.entries?.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">{LABELS[pool]} rating history</h3>
                <p className="text-xs text-white/50">Newest first · dates show when games settled.</p>
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
                        <td>{entry.change > 0 ? "+" : ""}{entry.change}</td>
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
        <summary className="cursor-pointer text-sm font-medium text-[#C9A84C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A84C]">How your rating works</summary>
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-white/60">
          <p>ChessBet uses Glicko-2. It estimates your playing strength from game results and the strength of your opponents—not Stockfish or move-by-move analysis.</p>
          <p>Your first {threshold} confirmed rated games in each time control establish your rating. You can see it from your first rated game as provisional; it becomes established when your {threshold}th game is rated. Early ratings can change more as the system learns your level.</p>
          <p>Ratings update after the 24-hour reporting window and any required reviews are complete. Your game is scored after it is confirmed, rather than immediately when it ends.</p>
          <p>Only your own confirmed rating history appears here. Ratings don't change your game result, wallet, or payouts.</p>
        </div>
      </details>
    </section>
  );
}
