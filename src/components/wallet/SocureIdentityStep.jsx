import React, { useState } from "react";
import { ShieldCheck, Loader2, CheckCircle2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function SocureIdentityStep({ identity, onRefresh }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await base44.functions.invoke("startSocureIdentityVerification", { consent });
      if (data?.status === "verified") { await onRefresh?.(); return; }
      const url = new URL(data?.hosted_url || data?.hostedUri || "");
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
      {identity?.verified ? <CheckCircle2 className="text-emerald-400 shrink-0" size={22} /> : <ShieldCheck className="text-[#C9A84C] shrink-0" size={22} />}
      <div className="flex-1">
        <h3 className="text-base font-semibold text-white">{identity?.verified ? "Identity verified" : "First, verify your identity"}</h3>
        <p className="mt-1 text-sm text-white/60" role="status">{identity?.message || "Identity verification is required before real-money activity."}</p>
        {!identity?.verified && <>
          <p className="mt-2 text-xs text-white/45">Socure securely checks your identity and age. Bank linking remains separate through Seamless and Plaid. Existing bank connections and wallet funds are preserved.</p>
          {identity?.can_start && <>
            <label className="mt-4 flex items-start gap-2 text-xs text-white/65">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />
              <span>I agree to start identity verification with Socure. I will review Socure's data and document permissions in its secure verification flow.</span>
            </label>
            <button type="button" onClick={start} disabled={busy || !consent} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl gold-gradient px-4 py-3 font-semibold text-black disabled:opacity-40">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? "Opening secure verification…" : identity.status === "pending" ? "Continue verification" : "Verify identity"}
            </button>
          </>}
          {!identity?.enabled && <p className="mt-3 text-xs text-amber-300">Identity verification is temporarily unavailable. Please contact support.</p>}
          <a className="mt-3 inline-block text-xs text-[#C9A84C] underline" href="mailto:hello@worldchessbet.com">Need help or access to existing funds? Contact support</a>
        </>}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  </section>;
}
