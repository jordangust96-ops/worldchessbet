import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Trophy, Minus, X } from "lucide-react";
import moment from "moment";

export default function RecentMatches({ userId }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const all = await base44.entities.Match.filter(
        { status: "completed" },
        "-created_date",
        5
      );
      const userMatches = all.filter(
        (m) => m.player1_id === userId || m.player2_id === userId
      );
      setMatches(userMatches);
      setLoading(false);
    };
    load();
  }, [userId]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-2xl bg-white/[0.03] animate-pulse" />
        ))}
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="text-center py-10 rounded-2xl bg-white/[0.02] border border-white/5">
        <p className="text-white/30 text-sm">No matches yet</p>
        <p className="text-white/20 text-xs mt-1">Your match history will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {matches.map((match) => {
        const won = match.winner_id === userId;
        const draw = match.result === "draw";
        return (
          <div
            key={match.id}
            className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  draw
                    ? "bg-white/10"
                    : won
                    ? "bg-[#C9A84C]/10"
                    : "bg-red-500/10"
                }`}
              >
                {draw ? (
                  <Minus size={16} className="text-white/50" />
                ) : won ? (
                  <Trophy size={16} className="text-[#C9A84C]" />
                ) : (
                  <X size={16} className="text-red-400" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {draw ? "Draw" : won ? "Victory" : "Defeat"}
                </p>
                <p className="text-[11px] text-white/30">
                  {moment(match.completed_at || match.created_date).fromNow()}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p
                className={`text-sm font-bold ${
                  draw ? "text-white/50" : won ? "text-[#C9A84C]" : "text-red-400"
                }`}
              >
                {draw ? "$0" : won ? `+$${match.wager_amount}` : `-$${match.wager_amount}`}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}