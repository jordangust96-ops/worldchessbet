import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

const tones = {
  healthy: "border-emerald-500/25 text-emerald-300",
  warning: "border-amber-400/30 text-amber-200",
  critical: "border-red-500/35 text-red-300",
  unknown: "border-white/15 text-white/60",
};
function date(value) {
  const parsed = new Date(value);
  return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Not yet recorded";
}
export default function AdminSiteHealth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ credit_used: "", credit_allowance: "", pending_credit_allowance: "", credit_cycle_started_at: "", credit_renews_at: "", tested_concurrent_players: "" });
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await base44.functions.invoke("getSiteHealth", {});
      setData(response.data);
      const config = response.data.config || {};
      setForm({
        credit_used: String(config.credit_used ?? ""), credit_allowance: String(config.credit_allowance ?? ""),
        pending_credit_allowance: String(config.pending_credit_allowance ?? 0),
        credit_cycle_started_at: config.credit_cycle_started_at?.slice(0, 10) || "",
        credit_renews_at: config.credit_renews_at?.slice(0, 10) || "",
        tested_concurrent_players: String(config.tested_concurrent_players || 0),
      });
    } catch { setError("Unable to read health monitoring. Access requires an administrator. Missing data is not a healthy result."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function saveCredits(event) {
    event.preventDefault(); setSaving(true); setNotice("");
    try {
      await base44.functions.invoke("updateSiteHealthSettings", {
        credit_used: Number(form.credit_used), credit_allowance: Number(form.credit_allowance),
        pending_credit_allowance: Number(form.pending_credit_allowance || 0),
        credit_cycle_started_at: new Date(form.credit_cycle_started_at + "T00:00:00Z").toISOString(),
        credit_renews_at: new Date(form.credit_renews_at + "T23:59:59Z").toISOString(),
      });
      await load(); setNotice("Credit reading saved. The next scheduled check will update the forecast.");
    } catch { setNotice("Could not save. Check the credit amounts and cycle dates."); }
    finally { setSaving(false); }
  }
  async function saveCapacity() {
    setSaving(true); setNotice("");
    try {
      await base44.functions.invoke("updateSiteHealthSettings", { tested_concurrent_players: Number(form.tested_concurrent_players) });
      await load(); setNotice("Tested capacity saved. Warnings start at 70% of this value.");
    } catch { setNotice("Could not save tested capacity."); }
    finally { setSaving(false); }
  }
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pb-16 pt-8 text-white">
      <div className="mx-auto max-w-5xl">
        <Link to="/profile" className="inline-flex items-center gap-2 text-sm text-white/50"><ArrowLeft size={15} /> Back to Profile</Link>
        <div className="mt-6 flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-widest text-[#C9A84C]">Admin only</p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold"><Activity /> Site Health</h1>
            <p className="mt-2 text-sm text-white/55">Availability, connection health, and early capacity warnings.</p></div>
          <button onClick={load} disabled={loading} className="rounded-lg border border-white/15 px-4 py-2 text-sm disabled:opacity-50">
            <RefreshCw size={14} className="mr-2 inline" /> Refresh report
          </button>
        </div>
        {loading && <div role="status" className="mt-8 text-white/60"><Loader2 className="mr-2 inline animate-spin" size={18} /> Reading monitoring data…</div>}
        {error && <p role="alert" className="mt-6 rounded-xl border border-red-500/30 p-4 text-red-300">{error}</p>}
        {!loading && data && <>
          <section className={"mt-6 rounded-2xl border bg-white/[0.025] p-5 " + (tones[data.status] || tones.unknown)}>
            <h2 className="text-lg font-bold capitalize">{data.status === "unknown" ? "Coverage incomplete" : data.status}</h2>
            <p className="mt-2 text-sm">{data.summary}</p>
            <p className="mt-3 text-xs text-white/45">Last collection: {date(data.checked_at)} · Every 15 minutes · Reports become stale after 35 minutes</p>
            <p className="mt-2 text-xs text-white/45">Alerts: {data.config?.alerts_enabled ? data.config.alert_email : "Disabled"} · Last email: {data.alert_delivery === "accepted" ? "Accepted by email service; inbox delivery unverified" : data.alert_delivery === "failed_or_unknown" ? "Delivery failed or unconfirmed" : "No alert sent"} · {date(data.last_alert_attempt_at)}</p>
          </section>
          <p className="mt-4 text-xs leading-6 text-white/45">{data.notice}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {(data.checks || []).map(c => <article key={c.key} className={"rounded-xl border bg-white/[0.02] p-4 " + (tones[c.status] || tones.unknown)}>
              <div className="flex justify-between gap-3"><h2 className="text-sm font-semibold text-white">{c.label}</h2><span className="text-xs capitalize">{c.status}</span></div>
              {c.value !== null && c.value !== undefined && <p className="mt-2 text-xl font-semibold">{c.value} <span className="text-xs font-normal text-white/40">{c.unit}</span></p>}
              <p className="mt-2 text-xs leading-5 text-white/55">{c.summary}</p>
            </article>)}
          </div>
          <details className="mt-6 rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-semibold">Recent observations</summary>
            <p className="mt-2 text-xs text-white/45">Up to six hours of collection history. Performance data is unavailable where a check did not report.</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-white/10"><th className="p-2">Time</th><th className="p-2">Overall</th><th className="p-2">Active games</th><th className="p-2">Analyzer backlog</th></tr></thead><tbody>
              {[...(data.history || [])].reverse().map(h => <tr key={h.at} className="border-b border-white/5"><td className="p-2">{date(h.at)}</td><td className="p-2">{h.status}</td><td className="p-2">{h.values?.active_games?.value ?? "Unknown"}</td><td className="p-2">{h.values?.analyzer_backlog?.value ?? "Unknown"}</td></tr>)}
            </tbody></table></div>
          </details>
          <details className="mt-4 rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-semibold">Credit forecast and tested capacity</summary>
            <p className="mt-3 text-xs leading-5 text-white/50">Base44 does not expose workspace credits through the connected SDK. Copy a fresh reading from its usage dashboard. Readings become unknown after 24 hours. This updates monitoring only; it does not change your subscription.</p>
            <form onSubmit={saveCredits} className="mt-4 grid gap-3 sm:grid-cols-2">
              {[["credit_used", "Workspace credits used", "number"], ["credit_allowance", "Current cycle allowance", "number"], ["pending_credit_allowance", "Next cycle allowance (0 if unchanged)", "number"], ["credit_cycle_started_at", "Cycle start (UTC date)", "date"], ["credit_renews_at", "Renewal (UTC date)", "date"]].map(([key, label, type]) => <label key={key} className="text-xs text-white/55">{label}<input required type={type} min={type === "number" ? "0" : undefined} step={type === "number" ? "any" : undefined} value={form[key]} onChange={e => change(key, e.target.value)} className="mt-1 block w-full rounded-lg border border-white/15 bg-[#171717] p-2 text-white" /></label>)}
              <div className="self-end"><button disabled={saving} className="rounded-lg bg-[#C9A84C] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">Save credit reading</button></div>
            </form>
            <div className="mt-6 border-t border-white/10 pt-4"><label className="text-xs text-white/55">Verified simultaneous-player capacity (0 until load tested)<input type="number" min="0" step="1" value={form.tested_concurrent_players} onChange={e => change("tested_concurrent_players", e.target.value)} className="mt-1 block w-full rounded-lg border border-white/15 bg-[#171717] p-2 text-white" /></label><button onClick={saveCapacity} disabled={saving} className="mt-3 rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-50">Save tested capacity</button></div>
            {notice && <p role="status" className="mt-3 text-sm text-[#C9A84C]">{notice}</p>}
          </details>
        </>}
      </div>
    </div>
  );
}
