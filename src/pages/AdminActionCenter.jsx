import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Gavel,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { base44 } from "@/api/base44Client";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "urgent", label: "High priority" },
  { id: "dispute", label: "Player reports" },
  { id: "integrity_flag", label: "Integrity flags" },
];

const PRIORITY_STYLE = {
  high: "border-red-500/25 bg-red-500/[0.055] text-red-300",
  medium: "border-amber-400/20 bg-amber-400/[0.045] text-amber-300",
  low: "border-white/[0.07] bg-white/[0.025] text-white/50",
};

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function SummaryCard({ label, value, icon: Icon, tone = "gold" }) {
  const toneClass = tone === "red" ? "text-red-400 bg-red-500/10" : "text-[#C9A84C] bg-[#C9A84C]/10";
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${toneClass}`}>
        <Icon size={16} />
      </div>
      <p className="mt-3 text-2xl font-extrabold text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-white/40">{label}</p>
    </div>
  );
}

function ActionCard({ item }) {
  const Icon = item.type === "dispute" ? Gavel : ShieldAlert;
  const evidenceLabel = item.evidence?.band
    ? item.evidence.band.replaceAll("_", " ")
    : "No completed screening";

  return (
    <article className={`rounded-2xl border p-5 ${PRIORITY_STYLE[item.priority] || PRIORITY_STYLE.medium}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-black/20 flex items-center justify-center shrink-0">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-white">{item.title}</h2>
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
              {item.priority} priority
            </span>
            {item.assigned_to_me && (
              <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/55">
                Assigned to you
              </span>
            )}
          </div>
          <p className="mt-1 text-xs capitalize text-white/45">{item.subtitle} · {item.status?.replaceAll("_", " ")}</p>
          <p className="mt-0.5 text-[10px] text-white/30">{formatDate(item.created_at)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#C9A84C]/20 bg-[#C9A84C]/[0.075] p-4">
        <div className="flex items-center gap-1.5 text-[#C9A84C]">
          <Sparkles size={14} />
          <p className="text-[10px] font-bold uppercase tracking-wider">Suggested next action</p>
        </div>
        <p className="mt-1.5 text-sm font-semibold leading-6 text-white">{item.recommendation}</p>
        <p className="mt-2 text-xs leading-5 text-white/50">{item.rationale}</p>
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Facts considered</p>
        <div className="mt-2 space-y-1.5">
          {(item.facts || []).map((fact, index) => (
            <div key={index} className="flex items-start gap-2 text-xs leading-5 text-white/55">
              <CheckCircle2 size={13} className="mt-1 shrink-0 text-[#C9A84C]/70" />
              <span>{fact}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        <p className="text-[10px] capitalize text-white/35">Automated evidence: {evidenceLabel}</p>
        <Link
          to={item.route}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-3 py-2 text-xs font-bold text-black hover:opacity-90"
        >
          Review and decide <ArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}

export default function AdminActionCenter() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const me = await base44.auth.me();
      if (me?.role !== "admin") {
        setIsAdmin(false);
        return;
      }
      setIsAdmin(true);
      const response = await base44.functions.invoke("getAdminActionCenter", {});
      setData(response.data);
    } catch {
      setError("Unable to load required admin actions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => {
    const all = data?.items || [];
    if (filter === "urgent") return all.filter((item) => item.urgent);
    if (filter === "dispute" || filter === "integrity_flag") return all.filter((item) => item.type === filter);
    return all;
  }, [data, filter]);

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
        <p className="font-semibold text-white">Access Restricted</p>
        <Link to="/" className="mt-3 text-xs text-[#C9A84C]">Return home</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pb-16 pt-8">
      <div className="mx-auto max-w-3xl">
        <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70">
          <ArrowLeft size={14} /> Back to Profile
        </Link>

        <div className="mt-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#C9A84C]">
              <BellRing size={20} />
              <p className="text-[10px] font-bold uppercase tracking-[0.18em]">Admin only</p>
            </div>
            <h1 className="mt-2 text-2xl font-extrabold text-white">Admin Action Center</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/45">
              Prioritized player reports and integrity flags, with evidence-based guidance for the next manual review step.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60 hover:bg-white/[0.04]"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-500/25 bg-red-500/[0.08] p-4">
            <p className="text-sm text-red-300">{error}</p>
            <button onClick={load} className="mt-2 text-xs font-semibold text-red-200 underline">Try again</button>
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard label="Require review" value={data?.count || 0} icon={BellRing} />
              <SummaryCard label="High priority" value={data?.urgent_count || 0} icon={AlertTriangle} tone="red" />
              <SummaryCard label="Player reports" value={data?.dispute_count || 0} icon={Gavel} />
              <SummaryCard label="Integrity flags" value={data?.integrity_flag_count || 0} icon={ShieldAlert} />
            </div>

            <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
              <p className="text-[11px] leading-5 text-white/40">{data?.notice}</p>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setFilter(option.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${filter === option.id ? "border-[#C9A84C]/40 bg-[#C9A84C]/10 text-[#C9A84C]" : "border-white/[0.07] text-white/40 hover:text-white/65"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {items.length ? (
                items.map((item) => <ActionCard key={item.id} item={item} />)
              ) : (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.055] p-8 text-center">
                  <CheckCircle2 size={26} className="mx-auto text-emerald-400" />
                  <p className="mt-3 text-sm font-bold text-white">
                    {data?.count ? "No actions match this filter" : "No admin action is currently required"}
                  </p>
                  <p className="mt-1 text-xs text-white/40">
                    {data?.count ? "Choose another filter to see the remaining work." : "New player reports and integrity flags will appear here automatically."}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
