import React, { useState, useEffect, useRef, useCallback } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import { setMfaVerified, clearMfaVerified } from "@/lib/mfaSession";
import { getPostAuthRedirect } from "@/lib/postAuthRedirect";
import SEO from "@/components/seo/SEO";

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function secondsUntil(deadlineMs) {
  if (!deadlineMs) return 0;
  return Math.max(0, Math.round((deadlineMs - Date.now()) / 1000));
}

export default function VerifyMfa() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("idle"); // 'idle' | 'sending' | 'verifying'
  const [loading, setLoading] = useState(true);
  const [hasChallenge, setHasChallenge] = useState(false);
  const [expiryDeadline, setExpiryDeadline] = useState(0); // absolute ms timestamp
  const [cooldownDeadline, setCooldownDeadline] = useState(0); // absolute ms timestamp
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  const [, setTick] = useState(0); // force re-render for deadline display

  const busyRef = useRef(false); // synchronous guard for overlapping handlers

  const applyMetadata = useCallback((data) => {
    if (!data) return;
    if (data.expires_at) {
      setExpiryDeadline(new Date(data.expires_at).getTime());
      setHasChallenge(true);
    }
    if (data.cooldown_seconds != null) {
      setCooldownDeadline(Date.now() + data.cooldown_seconds * 1000);
    } else if (data.retry_after_seconds != null) {
      setCooldownDeadline(Date.now() + data.retry_after_seconds * 1000);
    }
    if (data.attempts_remaining != null) {
      setAttemptsRemaining(data.attempts_remaining);
    }
  }, []);

  // Apply error metadata from any error response — used in ALL error paths.
  const applyError = useCallback((errData, fallbackMessage) => {
    const message = errData?.message || fallbackMessage || "Something went wrong. Please try again.";
    setError(message);
    setInfo("");
    if (errData?.expires_at) {
      setExpiryDeadline(new Date(errData.expires_at).getTime());
      setHasChallenge(true);
    } else if (errData?.error === "expired" || errData?.error === "too_many_attempts") {
      setHasChallenge(false);
    }
    if (errData?.retry_after_seconds != null) {
      setCooldownDeadline(Date.now() + errData.retry_after_seconds * 1000);
    }
    if (errData?.attempts_remaining != null) {
      setAttemptsRemaining(errData.attempts_remaining);
    }
  }, []);

  // --- Initial mount: resume existing challenge or request new ---
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await base44.functions.invoke("requestMfaOtp", { mode: "resume" });
        if (!active) return;
        applyMetadata(data);
        if (data.resumed || data.success) {
          setHasChallenge(true);
          if (!data.resumed) {
            setInfo("A new verification code has been sent to your email.");
          }
        }
      } catch (err) {
        if (!active) return;
        const errData = err?.response?.data;
        applyError(errData, "We couldn't load your verification challenge. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [applyMetadata, applyError]);

  // --- Absolute-deadline countdown (recalculates from Date.now each tick) ---
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Recalculate on visibility/focus (catches time elapsed while tab hidden) ---
  useEffect(() => {
    const recalc = () => setTick((t) => t + 1);
    document.addEventListener("visibilitychange", recalc);
    window.addEventListener("focus", recalc);
    return () => {
      document.removeEventListener("visibilitychange", recalc);
      window.removeEventListener("focus", recalc);
    };
  }, []);

  const expiresIn = secondsUntil(expiryDeadline);
  const cooldown = secondsUntil(cooldownDeadline);

  // --- Resend ---
  const handleResend = async () => {
    if (busyRef.current || cooldown > 0) return;
    busyRef.current = true;
    setBusy(true);
    setAction("sending");
    setError("");
    setInfo("");
    setCode("");
    try {
      const { data } = await base44.functions.invoke("requestMfaOtp", { mode: "resend" });
      applyMetadata(data);
      setHasChallenge(true);
      setInfo("A new verification code has been sent to your email.");
    } catch (err) {
      const errData = err?.response?.data;
      applyError(errData, "We couldn't send your verification code. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setAction("idle");
    }
  };

  // --- Verify ---
  const handleVerify = async () => {
    if (busyRef.current) return;
    const cleaned = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(cleaned)) {
      setError("Please enter all 6 digits.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setAction("verifying");
    setError("");
    setInfo("");
    try {
      const { data } = await base44.functions.invoke("verifyMfaOtp", { code: cleaned });
      setMfaVerified(data.session_token);
      window.location.href = getPostAuthRedirect() || "/play";
    } catch (err) {
      const errData = err?.response?.data;
      applyError(errData, "Verification failed. Please try again.");
      setCode("");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setAction("idle");
    }
  };

  const handleDifferentAccount = () => {
    clearMfaVerified();
    base44.auth.logout("/login");
  };

  if (loading) {
    return (
      <>
        <SEO title="Verify Your Identity | ChessBet" description="Complete account verification for ChessBet." noindex />
        <AuthLayout icon={ShieldCheck} title="Verify Your Identity" subtitle="Enter the 6-digit code we sent to your email">
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </AuthLayout>
      </>
    );
  }

  return (
    <>
      <SEO title="Verify Your Identity | ChessBet" description="Complete account verification for ChessBet." noindex />
      <AuthLayout icon={ShieldCheck} title="Verify Your Identity" subtitle="Enter the 6-digit code we sent to your email">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
        )}
        {info && !error && (
          <div className="mb-4 p-3 rounded-lg bg-[#C9A84C]/10 text-[#C9A84C] text-sm">{info}</div>
        )}

        <div className="flex justify-center mb-4">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={(val) => setCode(val.replace(/\D/g, "").slice(0, 6))}
            pasteTransformer={(pasted) => pasted.replace(/[\s-]/g, "")}
            autoFocus
            autoComplete="one-time-code"
            disabled={busy || attemptsRemaining <= 0}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>

        <p className="text-center text-xs text-muted-foreground mb-6">
          {!hasChallenge
            ? "No active verification challenge — request a new code"
            : expiresIn > 0
              ? `Code expires in ${formatTime(expiresIn)}`
              : "Code expired — request a new one"}
        </p>

        <Button
          className="w-full h-12 font-medium"
          onClick={handleVerify}
          disabled={busy || code.length < 6 || expiresIn <= 0 || attemptsRemaining <= 0}
        >
          {action === "verifying" ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : action === "sending" ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : (
            "Verify"
          )}
        </Button>

        <p className="text-center text-sm text-muted-foreground mt-4">
          Didn't receive the code?{" "}
          <button
            onClick={handleResend}
            disabled={cooldown > 0 || busy}
            className="text-primary font-medium hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {action === "sending" ? "Sending..." : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
          </button>
        </p>

        {attemptsRemaining < 5 && attemptsRemaining > 0 && (
          <p className="text-center text-xs text-muted-foreground mt-2">
            {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} remaining
          </p>
        )}

        <p className="text-center text-sm mt-2">
          <button onClick={handleDifferentAccount} className="text-muted-foreground hover:underline">
            Use a different account
          </button>
        </p>
      </AuthLayout>
    </>
  );
}