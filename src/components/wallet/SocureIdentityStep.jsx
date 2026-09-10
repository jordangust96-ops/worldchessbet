import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import WalletSetupStep from "./WalletSetupStep";
import { base44 } from "@/api/base44Client";

export default function SocureIdentityStep({ identity, onRefresh, locationApproved = true }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = identity?.verified ? "verified" : identity?.status || "not_started";
  const canStart = !identity?.submitted && identity?.can_start && ["not_started", "incomplete", "expired", "failed"].includes(status);
  const titles = {
    verified: "Identity Verified",
    pending: identity?.submitted ? "Verification submitted — pending" : "Confirming verification status",
    review_required: "Verification submitted — under review",
    rejected: "Verification not approved",
    incomplete: "Verification not completed",
    failed: "Verification could not be completed",
    expired: "Verification expired",
    not_started: "Verify your identity",
  };
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
  return <WalletSetupStep number={2} label="Identity verification" title={titles[status] || "Identity status unavailable"} complete={status === "verified"} pending={["pending", "review_required"].includes(status)} attention={["rejected", "failed", "expired", "incomplete"].includes(status)}
    description={status === "verified" ? null : status === "pending" ? (identity?.sync_unavailable ? "Status update delayed. Retrying automatically." : identity?.submitted ? "Submitted successfully. Your result will update here automatically." : "Checking whether your verification was completed.") : status === "review_required" ? "Submitted successfully. Your result will update here after review." : status === "rejected" ? "Not approved. Contact support for next steps." : !locationApproved ? "First, verify your location above." : status === "incomplete" ? "Start again to complete verification." : "Verify your identity and age securely with Socure."}>
    {canStart && <>
      <label className="mt-3 flex items-start gap-2 text-xs text-white/65">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />
        <span>I agree to identity and age verification with Socure.</span>
      </label>
      <button type="button" onClick={start} disabled={busy || !consent} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl gold-gradient px-4 py-3 text-sm font-semibold text-black disabled:opacity-40 sm:w-auto">
        {busy && <Loader2 size={16} className="animate-spin" />}
        {busy ? "Opening verification…" : status === "not_started" ? "Verify identity" : "Start verification over"}
      </button>
    </>}
    {!identity?.enabled && canStart !== true && ["not_started","incomplete","expired","failed"].includes(status) &&
      <p className="mt-2 text-xs text-amber-300">Verification is temporarily unavailable.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
  </WalletSetupStep>;
}

