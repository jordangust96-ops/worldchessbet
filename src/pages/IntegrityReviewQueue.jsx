import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { base44 } from "@/api/base44Client";
import IntegrityQueueRow from "@/components/integrity/IntegrityQueueRow";
import { SEVERITY_RANK } from "@/lib/integrityLabels";

export default function IntegrityReviewQueue() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState([]);
  const [userLabels, setUserLabels] = useState({});
  const [flagCountsByUser, setFlagCountsByUser] = useState({});
  const [filter, setFilter] = useState("active"); // active | all

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const me = await base44.auth.me();
    if (me?.role !== "admin") {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);

    const allFlags = await base44.entities.IntegrityFlag.list("-created_date", 500);
    const sorted = [...allFlags].sort((a, b) => {
      const rankDiff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.created_date) - new Date(a.created_date);
    });
    setFlags(sorted);

    const counts = {};
    allFlags.forEach((f) => {
      counts[f.user_id] = (counts[f.user_id] || 0) + 1;
    });
    setFlagCountsByUser(counts);

    const userIds = [...new Set(allFlags.map((f) => f.user_id))];
    const labels = {};
    await Promise.all(
      userIds.map(async (id) => {
        const u = await base44.entities.User.get(id).catch(() => null);
        labels[id] = u ? u.full_name || u.email || id : id;
      })
    );
    setUserLabels(labels);

    setLoading(false);
  };

  const visibleFlags = filter === "active" ? flags.filter((f) => f.status === "open" || f.status === "under_review") : flags;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0A] px-5 text-center">
        <p className="text-white font-semibold mb-2">Access Restricted</p>
        <p className="text-white/40 text-sm mb-4">You don't have permission to view this page.</p>
        <Link to="/profile" className="text-xs text-[#C9A84C] hover:underline">
          Back to Profile
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-2xl mx-auto">
      <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <ShieldAlert size={18} className="text-[#C9A84C]" />
        </div>
        <h1 className="text-xl font-extrabold text-white">Integrity Review Queue</h1>
      </div>
      <p className="text-xs text-white/40 mb-6">
        Sorted by highest severity, then newest first. Flags are indicators for review — no automatic action is taken.
      </p>

      <div className="flex gap-2 mb-5">
        {[
          { key: "active", label: "Active" },
          { key: "all", label: "All" },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              filter === opt.key
                ? "bg-[#C9A84C]/10 text-[#C9A84C] border-[#C9A84C]/30"
                : "bg-white/[0.03] text-white/40 border-white/10 hover:text-white/70"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {visibleFlags.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-8 text-center">
          <p className="text-sm text-white/40">No flags to review.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleFlags.map((flag) => (
            <IntegrityQueueRow
              key={flag.id}
              flag={flag}
              userLabel={userLabels[flag.user_id] || flag.user_id}
              previousFlagCount={Math.max((flagCountsByUser[flag.user_id] || 1) - 1, 0)}
            />
          ))}
        </div>
      )}
    </div>
  );
}