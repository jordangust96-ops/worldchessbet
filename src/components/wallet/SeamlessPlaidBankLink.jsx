import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import {
  ACH_AUTHORIZATION_TEXT,
  ACH_AUTHORIZATION_VERSION,
} from "../../../base44/shared/achAuthorization.js";

function legalNameParts(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

export default function SeamlessPlaidBankLink({
  legalName,
  disabled = false,
  onComplete,
}) {
  const initialName = useMemo(() => legalNameParts(legalName), [legalName]);
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const [savedLegalName, setSavedLegalName] = useState(String(legalName || "").trim());
  const [signerName, setSignerName] = useState(String(legalName || "").trim());
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [providerOrigin, setProviderOrigin] = useState("");
  const iframeRef = useRef(null);
  const refreshTimers = useRef([]);

  useEffect(() => () => {
    refreshTimers.current.forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!linkUrl || !providerOrigin) return undefined;

    const handleMessage = (event) => {
      if (event.origin !== providerOrigin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const eventName = event.data?.event;

      if (eventName === "callCloseFunction") {
        setLinkUrl("");
        return;
      }
      if (eventName === "callErrorFunction") {
        setLinkUrl("");
        setError("Plaid could not verify that bank account. Please try again.");
        onComplete?.();
        return;
      }
      if (eventName !== "callSuccessFunction") return;

      setLinkUrl("");
      setMessage("Bank details received securely. Waiting for Seamless to confirm verification…");
      refreshTimers.current.forEach((timer) => clearTimeout(timer));
      refreshTimers.current = [0, 2500, 6000, 12000].map((delay) =>
        setTimeout(() => onComplete?.(), delay)
      );
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [linkUrl, providerOrigin, onComplete]);

  const copyAuthorization = async () => {
    try {
      await navigator.clipboard.writeText(ACH_AUTHORIZATION_TEXT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Copy was unavailable. You can select and save the authorization text below.");
    }
  };

  const start = async () => {
    if (busy || disabled || !consentAccepted) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      let effectiveLegalName = savedLegalName;
      if (!effectiveLegalName) {
        if (!firstName.trim() || !lastName.trim()) {
          throw new Error("Enter your legal first and last name.");
        }
        const { data } = await base44.functions.invoke("setFundingLegalName", {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
        if (!data?.saved || !data?.full_name) {
          throw new Error("We couldn't save your legal name.");
        }
        effectiveLegalName = data.full_name;
        setSavedLegalName(effectiveLegalName);
        setSignerName(effectiveLegalName);
      }

      const effectiveSigner = (signerName || effectiveLegalName).trim();
      if (effectiveSigner.toLocaleLowerCase("en-US") !== effectiveLegalName.toLocaleLowerCase("en-US")) {
        throw new Error("Your electronic signature must exactly match your legal name.");
      }

      // Server-side bank onboarding validates saved location approval and KYC.
      // Never repeat location verification while connecting or changing banks.

      const { data: profile } = await base44.functions.invoke("ensureSeamlessCustomer", {});
      if (!profile?.enabled) {
        throw new Error(profile?.reason || "Secure bank connection is unavailable right now.");
      }

      const { data } = await base44.functions.invoke("createSeamlessBankLinkUrl", {
        signerName: effectiveSigner,
        consentAccepted: true,
        authorizationVersion: ACH_AUTHORIZATION_VERSION,
      });
      if (!data?.enabled || !data?.link_url || !data?.provider_origin) {
        throw new Error(data?.reason || "Unable to open secure bank verification.");
      }

      const hosted = new URL(data.link_url);
      if (!["https://dashboard.seamlesschex.com","https://sandbox.seamlesschex.com"].includes(hosted.origin) || hosted.origin !== data.provider_origin || hosted.username || hosted.password) throw new Error("The secure bank link could not be validated.");
      setProviderOrigin(data.provider_origin);
      setLinkUrl(data.link_url);
    } catch (err) {
      const serverError = err?.response?.data?.error;
      const friendly = {
        signature_mismatch: "Your electronic signature must exactly match your legal name.",
        ach_authorization_required: "Accept the ACH authorization before continuing.",
        trusted_app_origin_required: "Secure bank connection is unavailable from this address.",
      }[serverError];
      setError(friendly || (typeof serverError === "string" ? serverError : "") || err?.message || "Unable to start secure bank verification.");
    } finally {
      setBusy(false);
    }
  };

  const canStart =
    !disabled &&
    consentAccepted &&
    (savedLegalName || (firstName.trim() && lastName.trim())) &&
    (signerName.trim() || (!savedLegalName && firstName.trim() && lastName.trim()));

  return (
    <>
      <div className="space-y-3 rounded-xl border border-white/10 bg-black/10 p-3">
        <div className="flex items-start gap-2 text-xs text-white/55">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#C9A84C]" />
          <span>
            SeamlessChex uses Plaid to verify your bank instantly. Your bank login and account numbers never pass through ChessBet.
          </span>
        </div>

        {!savedLegalName && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value.slice(0, 80))}
              placeholder="Legal first name"
              disabled={disabled || busy}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm text-white placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
            />
            <input
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value.slice(0, 120))}
              placeholder="Legal last name"
              disabled={disabled || busy}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm text-white placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
            />
          </div>
        )}

        <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">ACH authorization</p>
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
            Electronic signature — enter your legal name
          </label>
          <input
            type="text"
            autoComplete="name"
            value={signerName}
            onChange={(event) => setSignerName(event.target.value.slice(0, 200))}
            placeholder={savedLegalName || "Legal first and last name"}
            disabled={disabled || busy}
            className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm text-white placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
          />
        </div>

        <Button
          onClick={start}
          disabled={!canStart || busy}
          className="h-11 w-full rounded-xl gold-gradient font-bold text-black disabled:opacity-40"
        >
          {busy ? (
            <><Loader2 size={15} className="mr-2 animate-spin" /> Preparing secure connection…</>
          ) : (
            <><ExternalLink size={15} className="mr-2" /> Connect securely with Plaid</>
          )}
        </Button>

        {message && <p className="text-center text-xs text-emerald-300/80">{message}</p>}
        {error && (
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-red-400">
            <AlertTriangle size={13} /> {error}
          </p>
        )}
      </div>

      {linkUrl && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-3" role="dialog" aria-modal="true" aria-label="Connect bank account">
          <div className="relative h-[min(760px,96vh)] w-full max-w-[430px] overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
            <button
              type="button"
              onClick={() => setLinkUrl("")}
              className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
              aria-label="Close bank connection"
            >
              <X size={18} />
            </button>
            <iframe
              ref={iframeRef}
              title="SeamlessChex secure bank verification"
              src={linkUrl}
              className="h-full w-full border-0"
              allow="clipboard-read; clipboard-write"
            />
          </div>
        </div>
      )}
    </>
  );
}
