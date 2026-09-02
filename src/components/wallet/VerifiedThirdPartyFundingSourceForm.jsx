import React, { useState } from "react";
import { CheckCircle2, Copy, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import {
  ACH_AUTHORIZATION_TEXT,
  ACH_AUTHORIZATION_VERSION,
} from "../../../base44/shared/achAuthorization.js";

export default function VerifiedThirdPartyFundingSourceForm({
  legalName,
  disabled,
  onComplete,
}) {
  const [bankName, setBankName] = useState("");
  const [accountType, setAccountType] = useState("checking");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [signerName, setSignerName] = useState(legalName || "");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const valid =
    !disabled &&
    bankName.trim().length >= 2 &&
    /^\d{9}$/.test(routingNumber) &&
    /^\d{4,34}$/.test(accountNumber) &&
    accountNumber === confirmAccountNumber &&
    signerName.trim().toLocaleLowerCase("en-US") === String(legalName || "").trim().toLocaleLowerCase("en-US") &&
    consentAccepted;

  const copyAuthorization = async () => {
    try {
      await navigator.clipboard.writeText(ACH_AUTHORIZATION_TEXT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Copy was unavailable. You can select and save the authorization text below.");
    }
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const { data: profile } = await base44.functions.invoke("ensureSeamlessCustomer", {});
      if (!profile?.enabled) throw new Error(profile?.reason || "Payment profile unavailable.");
      const { data } = await base44.functions.invoke("createVerifiedSeamlessFundingSource", {
        bankName: bankName.trim(),
        accountType,
        routingNumber,
        accountNumber,
        signerName: signerName.trim(),
        consentAccepted: true,
        authorizationVersion: ACH_AUTHORIZATION_VERSION,
      });
      setRoutingNumber("");
      setAccountNumber("");
      setConfirmAccountNumber("");
      setConsentAccepted(false);
      if (data?.enrollment?.state === "verified") {
        setMessage("Your bank account is verified and ready.");
      } else if (data?.human_review_required) {
        setMessage("This bank account needs review before it can be used.");
      } else if (data?.reconciliation_required) {
        setMessage("We need to reconcile this request before you try again. Contact support.");
      } else {
        setMessage("Your bank enrollment is being processed.");
      }
      if (onComplete) await onComplete();
    } catch (error) {
      const data = error?.response?.data;
      setMessage(
        data?.error === "signature_mismatch"
          ? "Your electronic signature must exactly match your verified legal name."
          : data?.error || error?.message || "We couldn't verify this bank account."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/10 p-3">
      <div className="flex items-start gap-2 text-xs text-white/55">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#C9A84C]" />
        <span>
          ChessBet will screen this account with Socure before asking SeamlessChex
          to create a verified funding source.
        </span>
      </div>

      <input
        type="text"
        autoComplete="organization"
        value={bankName}
        onChange={(event) => setBankName(event.target.value.slice(0, 200))}
        placeholder="Bank name"
        disabled={disabled || busy}
        className="w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
      />
      <select
        value={accountType}
        onChange={(event) => setAccountType(event.target.value)}
        disabled={disabled || busy}
        className="w-full h-11 px-4 rounded-xl bg-[#171717] border border-white/10 text-white text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
      >
        <option value="checking">Checking account</option>
        <option value="savings">Savings account</option>
      </select>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={routingNumber}
        onChange={(event) => setRoutingNumber(event.target.value.replace(/\D/g, "").slice(0, 9))}
        placeholder="9-digit routing number"
        disabled={disabled || busy}
        className="w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
      />
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={accountNumber}
        onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 34))}
        placeholder="Bank account number"
        disabled={disabled || busy}
        className="w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
      />
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={confirmAccountNumber}
        onChange={(event) => setConfirmAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 34))}
        placeholder="Confirm bank account number"
        disabled={disabled || busy}
        className="w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
      />
      {confirmAccountNumber && accountNumber !== confirmAccountNumber && (
        <p className="text-xs text-red-400">The account numbers do not match.</p>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">ACH debit authorization</p>
          <button
            type="button"
            onClick={copyAuthorization}
            className="flex items-center gap-1 text-[11px] text-white/45 hover:text-white"
          >
            {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-white/60">{ACH_AUTHORIZATION_TEXT}</p>
      </div>

      <label className="flex items-start gap-2 text-xs text-white/70">
        <input
          type="checkbox"
          checked={consentAccepted}
          onChange={(event) => setConsentAccepted(event.target.checked)}
          disabled={disabled || busy}
          className="mt-0.5"
        />
        <span>I have read this authorization and agree to its terms.</span>
      </label>

      <div>
        <label className="text-[11px] text-white/45">
          Electronic signature — enter your verified legal name
        </label>
        <input
          type="text"
          autoComplete="name"
          value={signerName}
          onChange={(event) => setSignerName(event.target.value.slice(0, 200))}
          placeholder={legalName || "Verified legal name"}
          disabled={disabled || busy}
          className="mt-1 w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
        />
      </div>

      <Button
        onClick={submit}
        disabled={!valid || busy}
        className="w-full h-11 rounded-xl gold-gradient text-black font-bold disabled:opacity-40"
      >
        {busy ? <><Loader2 size={15} className="animate-spin mr-2" /> Verifying bank…</> : "Authorize & verify bank"}
      </Button>
      {message && <p className="text-xs text-center text-white/60">{message}</p>}
    </div>
  );
}
