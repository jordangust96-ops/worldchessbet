import React, { useState, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { evaluateJurisdictionAccess } from "@/lib/jurisdictionAccess";

const COPY = {
  not_started: "Verify your identity before funding or entering paid contests.",
  pending: "Your identity verification is in progress.",
  review_required: "Your identity verification needs review. You can try again when available.",
  rejected: "We could not verify your identity. You can try again when available.",
  failed: "Identity verification could not be completed. Please try again.",
  expired: "Your identity verification session expired. Please start again.",
};

export default function SocureIdentityVerificationPanel({
  status = "not_started",
  fullName = "",
  onNameSaved,
  wallet,
  onRefresh,
}) {
  const initialParts = fullName.trim().split(/\s+/).filter(Boolean);
  const [firstName, setFirstName] = useState(initialParts[0] || "");
  const [lastName, setLastName] = useState(initialParts.slice(1).join(" "));
  const [savedFullName, setSavedFullName] = useState(fullName.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasLegalName = savedFullName.split(/\s+/).filter(Boolean).length >= 2;

  // The status shown to the user. Starts from the page-load value but is kept
  // current by polling while a verification is pending — Socure's hosted flow
  // redirects the browser straight back to /wallet, often before the
  // socureIdentityWebhook has landed, so without this the panel would show
  // "in progress" indefinitely until the user manually reloads. Mirrors the
  // poll pattern already used by SeamlessFundingPanel for bank-link status.
  const [liveStatus, setLiveStatus] = useState(status);
  const [pendingExpiresAt, setPendingExpiresAt] = useState("");
  const [clock, setClock] = useState(Date.now());
  const pollAttempts = useRef(0);

  useEffect(() => {
    setLiveStatus(status);
    pollAttempts.current = 0;
  }, [status]);

  useEffect(() => {
    if (liveStatus !== "pending") {
      setPendingExpiresAt("");
      return;
    }

    let cancelled = false;
    const loadPendingSession = async () => {
      try {
        const me = await base44.auth.me();
        const rows = await base44.entities.SocureIdentityVerification.filter(
          { user_id: me.id, status: "pending" },
          "-created_date",
          1
        );
        if (!cancelled) setPendingExpiresAt(rows[0]?.expires_at || "");
      } catch {
        // Fail closed in the UI: keep the pending state instead of reopening a
        // potentially already-completed hosted session.
      }
    };
    loadPendingSession();
    return () => { cancelled = true; };
  }, [liveStatus]);

  useEffect(() => {
    const expiresAtMs = Date.parse(pendingExpiresAt || "");
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return;
    const timer = setTimeout(() => setClock(Date.now()), expiresAtMs - Date.now() + 250);
    return () => clearTimeout(timer);
  }, [pendingExpiresAt, clock]);

  useEffect(() => {
    if (liveStatus !== "pending" || pollAttempts.current >= 10) return;
    const timer = setTimeout(async () => {
      pollAttempts.current += 1;
      try {
        const me = await base44.auth.me();
        const next = me?.identity_verification_status || "pending";
        if (next !== liveStatus) {
          setLiveStatus(next);
          // Let the Wallet page refresh account state, wallet, and the funding
          // panel's own status once verification actually resolves, instead of
          // only updating this panel's local copy.
          if (next !== "pending") onRefresh?.();
        }
      } catch {
        // Transient failure; the next scheduled attempt (or a manual reload)
        // will pick up the latest status.
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [liveStatus, onRefresh]);

  const saveLegalName = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("Enter your legal first and last name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await base44.functions.invoke("setFundingLegalName", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      if (!data?.saved || !data?.full_name) throw new Error("legal_name_update_failed");
      setSavedFullName(data.full_name);
      onNameSaved?.(data.full_name);
    } catch {
      setError("We couldn't save your legal name. Please review it and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!hasLegalName) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
            <ShieldCheck size={18} className="text-[#C9A84C]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">Step 1</p>
            <p className="text-sm font-medium text-white mt-0.5">Confirm your legal name</p>
            <p className="text-xs text-white/50 mt-1">
              Use the first and last name shown on your identity and bank records.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <input
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            placeholder="Legal first name"
            maxLength={80}
            className="h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none"
          />
          <input
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            placeholder="Legal last name"
            maxLength={120}
            className="h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none"
          />
        </div>
        <Button
          onClick={saveLegalName}
          disabled={busy || !firstName.trim() || !lastName.trim()}
          className="w-full mt-4 h-10 rounded-xl gold-gradient text-black font-bold disabled:opacity-40"
        >
          {busy ? <><Loader2 size={15} className="animate-spin mr-2" /> Saving?</> : "Save and continue"}
        </Button>
        {error && <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}
      </div>
    );
  }

  if (liveStatus === "verified") {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 flex items-center gap-3">
        <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
        <div>
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">Step 1</p>
          <p className="text-sm font-medium text-emerald-200 mt-0.5">Identity verified</p>
          <p className="text-xs text-emerald-200/60 mt-0.5">You can continue to bank connection.</p>
        </div>
      </div>
    );
  }

  const pendingExpiresAtMs = Date.parse(pendingExpiresAt || "");
  const pendingSessionActive =
    liveStatus === "pending" &&
    (!Number.isFinite(pendingExpiresAtMs) || pendingExpiresAtMs > clock);
  const displayedStatus =
    liveStatus === "pending" && !pendingSessionActive ? "expired" : liveStatus;

  if (pendingSessionActive) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
            <Loader2 size={18} className="text-[#C9A84C] animate-spin" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">Step 1</p>
            <p className="text-sm font-medium text-white mt-0.5">Identity verification in progress</p>
            <p className="text-xs text-white/50 mt-1">
              We’re waiting for Socure’s result. This page updates automatically; please do not restart the verification while this session is active.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      // Paid contests and new funding require an approved jurisdiction, so
      // re-check immediately before starting identity verification instead of
      // relying on the page-load check, which can be several minutes stale by
      // the time the user clicks. Skipped only when the user already holds a
      // withdrawable balance: identity verification is also this app's
      // prerequisite for withdrawing existing funds, and jurisdiction must
      // never stand between a user and their own money.
      const hasWithdrawableBalance = (wallet?.available_balance || 0) > 0;
      if (!hasWithdrawableBalance) {
        const { data: jurisdiction } = await base44.functions.invoke("getCurrentJurisdiction", {
          triggerEvent: "identity_verification_start",
        });
        const decision = evaluateJurisdictionAccess(jurisdiction);
        if (!decision.allowed) {
          throw new Error(
            decision.reason || "Identity verification is unavailable from your current location."
          );
        }
      }

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
          <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">Step 1</p>
          <p className="text-sm font-medium text-white mt-0.5">Verify your identity</p>
          <p className="text-xs text-white/50 mt-1">{COPY[displayedStatus] || COPY.not_started}</p>
        </div>
      </div>
      <Button onClick={start} disabled={busy} className="w-full mt-4 h-10 rounded-xl gold-gradient text-black font-bold disabled:opacity-40">
        {busy ? <><Loader2 size={15} className="animate-spin mr-2" /> Starting…</> : displayedStatus === "expired" ? "Start a new verification" : "Verify identity"}
      </Button>
      {error && <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}
    </div>
  );
}
