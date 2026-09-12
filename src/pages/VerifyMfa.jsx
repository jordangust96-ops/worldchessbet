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

export default function VerifyMfa() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expiresIn, setExpiresIn] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  const mountedRef = useRef(false);

  const applyResponse = useCallback((data) => {
    if (data.expires_at) {
      const secondsLeft = Math.max(0, Math.round((new Date(data.expires_at).getTime() - Date.now()) / 1000));
      setExpiresIn(secondsLeft);
    }
    if (data.cooldown_seconds != null) {
      setCooldown(data.cooldown_seconds);
    } else if (data.retry_after_seconds != null) {
      setCooldown(data.retry_after_seconds);
    }
    if (data.attempts_remaining != null) {
      setAttemptsRemaining(data.attempts_remaining);
    }
  }, []);

  // --- Initial mount: resume existing challenge or request new ---
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    (async () => {
      try {
        const { data } = await base44.functions.invoke("requestMfaOtp", { mode: "resume" });
        applyResponse(data);
        if (!data.resumed) {
          setInfo("A new verification code has been sent to your email.");
        }
      } catch (err) {
        setError(err?.response?.data?.message || "We couldn't load your verification challenge. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [applyResponse]);

  // --- Expiry countdown ---
  useEffect(() => {
    if (expiresIn <= 0) return;
    const timer = setInterval(() => setExpiresIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [expiresIn > 0]);

  // --- Cooldown countdown ---
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  // --- Resend ---
  const handleResend = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError("");
    setInfo("");
    setCode("");
    try {
      const { data } = await base44.functions.invoke("requestMfaOtp", { mode: "resend" });
      applyResponse(data);
      setInfo("A new verification code has been sent to your email.");
    } catch (err) {
      const errData = err?.response?.data;
      if (errData?.error === "cooldown" || errData?.error === "rate_limited") {
        setError(errData.message);
        if (errData.retry_after_seconds != null) setCooldown(errData.retry_after_seconds);
        if (errData.expires_at) {
          const s = Math.max(0, Math.round((new Date(errData.expires_at).getTime() - Date.now()) / 1000));
          setExpiresIn(s);
        }
      } else {
        setError(errData?.message || "We couldn't send your verification code. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  // --- Verify ---
  const handleVerify = async () => {
    if (busy) return;
    const cleaned = code.replace(/\D/g, "");
    if (!/^\d{6}$/.test(cleaned)) {
      setError("Please enter all 6 digits.");
      return;
    }
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const { data } = await base44.functions.invoke("verifyMfaOtp", { code: cleaned });
      setMfaVerified(data.session_token);
      window.location.href = getPostAuthRedirect() || "/play";
    } catch (err) {
      const errData = err?.response?.data;
      if (errData?.error === "too_many_attempts") {
        setError(errData.message);
        setAttemptsRemaining(0);
      } else if (errData?.error === "expired") {
        setError(errData.message);
        setExpiresIn(0);
      } else if (errData?.error === "already_used") {
        setError(errData.message);
      } else if (errData?.error === "invalid") {
        setError(errData.message || "Invalid code. Please try again.");
        if (errData.attempts_remaining != null) setAttemptsRemaining(errData.attempts_remaining);
      } else {
        setError(errData?.message || "Verification failed. Please try again.");
      }
      setCode("");
    } finally {
      setBusy(false);
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
            autoFocus
            autoComplete="one-time-code"
            disabled={busy}
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
          {expiresIn > 0
            ? `Code expires in ${formatTime(expiresIn)}`
            : "Code expired — request a new one"}
        </p>

        <Button
          className="w-full h-12 font-medium"
          onClick={handleVerify}
          disabled={busy || code.length < 6 || expiresIn <= 0}
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying...
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
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
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