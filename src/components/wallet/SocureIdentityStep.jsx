import React, { useState } from "react";
import { ShieldCheck, Loader2, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function SocureIdentityStep({ identity, onRefresh, nextStepLabel = "Continue to bank connection", onNextStep }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState("");
  const status = identity?.verified ? "verified" : identity?.status || "not_started";
  const waiting = ["pending", "review_required"].includes(status);
  const titles = {
    verified: "Identity verified",
    pending: "Verification pending",
    review_required: "Verification under review",
    rejected: "Verification not approved",
    failed: "Verification could not be completed",
    expired: "Verification session expired",
    not_started: "First, verify your identity",
  };
  const Icon = status === "verified" ? CheckCircle2 : waiting ? Clock :
    ["rejected", "failed", "expired"].includes(status) ? AlertTriangle : ShieldCheck;
  const refresh = async () => {
    setChecking(true); setCheckMessage(""); setError("");
    try {
      const next = await onRefresh?.();
      if (next?.identity && ["pending", "review_required"].includes(next.identity.status))
        setCheckMessage("No new result yet. You can leave this page and check back later.");
    } catch {
      setError("We couldn't refresh your result. Please try again.");
    } finally { setChecking(false); }
  };
  const start = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await base44.functions.invoke("startSocureIdentityVerification", { consent });
      if (data?.status === "verified") { await onRefresh?.(); return; }
      const url = new URL(data?.redirect_uri || "");
      if (url.origin !== "https://riskos.socure.com" || !url.pathname.startsWith("/hosted/") || url.username || url.password)
        throw new Error("The verification link could not be validated.");
      window.location.assign(url.href);
    } catch (e) {
      setError(e?.response?.data?.error || "We couldn't start identity verification. Please try again or contact support.");
      await onRefresh?.();
    } finally { setBusy(false); }
  };
  return <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5" aria-label="Identity verification">
    <div className="flex items-start gap-3">
      <Icon className={status === "verified" ? "text-emerald-400 shrink-0" : "text-[#C9A84C] shrink-0"} size={22} />
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-white">{titles[status] || "Verification needs attention"}</h3>
        <p className="mt-1 text-sm text-white/60" role="status">{identity?.message || "Identity verification is required before real-money activity."}</p>
        {identity?.verified && onNextStep && <button type="button" onClick={onNextStep} className="mt-4 rounded-xl gold-gradient px-4 py-3 font-semibold text-black">{nextStepLabel}</button>}
        {waiting && <>
          {identity?.sync_unavailable && <p role="status" className="mt-2 text-xs text-amber-300">The latest result check is delayed. We have not confirmed approval yet. Please try Check verification status again shortly.</p>}
          <p className="mt-3 text-xs text-white/60">Deposits and real-money play unlock only after approval. Your linked banks remain connected.</p>
          <button type="button" onClick={refresh} disabled={checking} className="mt-3 rounded-xl border border-white/20 px-4 py-2 text-sm text-white disabled:opacity-40">
            {checking ? "Checking result…" : "Check verification status"}
          </button>
          {status === "pending" && identity?.can_start && !resuming && <button type="button" onClick={() => setResuming(true)} className="mt-3 block text-xs text-[#C9A84C] underline">Didn't finish? Resume secure verification</button>}
          {checkMessage && <p role="status" className="mt-2 text-xs text-white/60">{checkMessage}</p>}
        </>}
        {!identity?.verified && <>
          <p className="mt-2 text-xs text-white/45">Socure securely checks your identity and age. Bank linking remains separate through Seamless and Plaid. Existing bank connections and wallet funds are preserved.</p>
          {identity?.can_start && ["not_started","failed","expired","pending"].includes(status) && (!waiting || resuming) && <>
            <label className="mt-4 flex items-start gap-2 text-xs text-white/65">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />
              <span>I agree to start identity verification with Socure. I will review Socure's data and document permissions in its secure verification flow.</span>
            </label>
            <button type="button" onClick={start} disabled={busy || !consent} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl gold-gradient px-4 py-3 font-semibold text-black disabled:opacity-40">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? "Opening secure verification…" : identity.status === "pending" ? "Continue verification" : "Verify identity"}
            </button>
          </>}
          {!identity?.enabled && !waiting && status !== "rejected" && <p className="mt-3 text-xs text-amber-300">Identity verification is temporarily unavailable. Please contact support.</p>}
          <a className="mt-3 inline-block text-xs text-[#C9A84C] underline" href="mailto:hello@worldchessbet.com">Need help or access to existing funds? Contact support</a>
        </>}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  </section>;
}
