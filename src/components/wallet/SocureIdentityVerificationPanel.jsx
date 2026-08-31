import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { DEMO_MODE } from "@/lib/appConfig";

const COPY = {
  not_started: "Verify your identity before funding or entering paid contests.",
  pending: "Your identity verification is in progress.",
  review_required: "Your identity verification needs review. You can try again when available.",
  rejected: "We could not verify your identity. You can try again when available.",
  failed: "Identity verification could not be completed. Please try again.",
  expired: "Your identity verification session expired. Please start again.",
};

export default function SocureIdentityVerificationPanel({ status = "not_started" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The server retains the authoritative Early Access switch. Hiding this
  // launch-only control keeps the existing demo experience unchanged.
  if (DEMO_MODE) return null;

  if (status === "verified") {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 flex items-center gap-3">
        <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-200">Identity verified</p>
          <p className="text-xs text-emerald-200/60 mt-0.5">Your account is eligible for the identity-verification requirement.</p>
        </div>
      </div>
    );
  }

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const { data } = await base44.functions.invoke("startSocureIdentityVerification", {});
      if (!data?.enabled || !data?.redirect_uri) {
        throw new Error(data?.reason || "Identity verification is unavailable right now.");
      }
      // This URL is a short-lived hosted-flow handoff returned by the server;
      // the browser redirect alone never changes eligibility.
      window.location.assign(data.redirect_uri);
    } catch (err) {
      setError(err?.message || "Unable to start identity verification.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <ShieldCheck size={18} className="text-[#C9A84C]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Identity verification</p>
          <p className="text-xs text-white/50 mt-1">{COPY[status] || COPY.not_started}</p>
        </div>
      </div>
      <Button onClick={start} disabled={busy} className="w-full mt-4 h-10 rounded-xl gold-gradient text-black font-bold disabled:opacity-40">
        {busy ? <><Loader2 size={15} className="animate-spin mr-2" /> Starting…</> : "Verify identity"}
      </Button>
      {error && <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}
    </div>
  );
}
