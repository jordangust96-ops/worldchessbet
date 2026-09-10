import React, { useState } from "react";
import { ShieldCheck, Loader2, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function SocureIdentityStep({ identity, onRefresh }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = identity?.verified ? "verified" : identity?.status || "not_started";
  const canStart = !identity?.submitted && identity?.can_start && ["not_started", "incomplete", "expired", "failed"].includes(status);
  const titles = {
    verified: "Identity verified",
    pending: identity?.submitted ? "Verification submitted — pending" : "Confirming verification status",
    review_required: "Verification submitted — under review",
    rejected: "Verification not approved",
    incomplete: "Verification not completed",
    failed: "Verification could not be completed",
    expired: "Verification expired",
    not_started: "Verify your identity",
  };
  const Icon = status === "verified" ? CheckCircle2 :
    ["pending", "review_required"].includes(status) ? Clock :
    ["rejected", "failed", "expired", "incomplete"].includes(status) ? AlertTriangle : ShieldCheck;
  const start = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await base44.functions.invoke("startSocureIdentityVerification", { consent });
      if (!data?.redirect_uri) { await onRefresh?.(); return; }
      const url = new URL(data.redirect_uri);
      if (url.origin !== "https://riskos.socure.com" || !url.pathname.startsWith("/hosted/") || url.username || url.password)
        throw new Error("Invalid verification link");
      window.location.assign(url.href);
    } catch (e) {
      setError(typeof e?.response?.data?.error === "string" ? e.response.data.error : "Verification is temporarily unavailable.");
      await onRefresh?.();
    } finally { setBusy(false); }
  };
  return <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5" aria-label="Identity verification">
    <div className="flex items-start gap-3">
      <Icon className={status === "verified" ? "text-emerald-400 shrink-0" : "text-[#C9A84C] shrink-0"} size={22} />
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-white" role="status" aria-live="polite">{titles[status] || "Verification status unavailable"}</h3>
        {canStart && <>
          <label className="mt-3 flex items-start gap-2 text-xs text-white/65">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />
            <span>I agree to identity and age verification with Socure.</span>
          </label>
          <button type="button" onClick={start} disabled={busy || !consent} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl gold-gradient px-4 py-3 font-semibold text-black disabled:opacity-40">
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "Opening verification…" : status === "not_started" ? "Verify identity" : "Start verification over"}
          </button>
        </>}
        {!identity?.enabled && canStart !== true && ["not_started","incomplete","expired","failed"].includes(status) &&
          <p className="mt-2 text-xs text-amber-300">Verification is temporarily unavailable.</p>}
        {identity?.sync_unavailable && status === "pending" && <p className="mt-2 text-xs text-white/60">Status update delayed. Retrying automatically.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  </section>;
}

