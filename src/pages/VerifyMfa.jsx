import React, { useState, useEffect, useRef } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import { setMfaVerified, clearMfaVerified } from "@/lib/mfaSession";
import { getPostAuthRedirect } from "@/lib/postAuthRedirect";

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VerifyMfa() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(true);
  const [expiresIn, setExpiresIn] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const hasSentInitial = useRef(false);

  const requestCode = async () => {
    setSending(true);
    setError("");
    try {
      const { data } = await base44.functions.invoke("requestMfaOtp", {});
      const secondsLeft = Math.max(0, Math.round((new Date(data.expires_at).getTime() - Date.now()) / 1000));
      setExpiresIn(secondsLeft);
      setCooldown(data.cooldown_seconds || 60);
    } catch (err) {
      const message = err?.response?.data?.message || "We couldn't send your verification code. Please try again.";
      setError(message);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (hasSentInitial.current) return;
    hasSentInitial.current = true;
    requestCode();
  }, []);

  useEffect(() => {
    if (expiresIn <= 0) return;
    const timer = setInterval(() => setExpiresIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [expiresIn > 0]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  const handleVerify = async () => {
    setVerifying(true);
    setError("");
    try {
      await base44.functions.invoke("verifyMfaOtp", { code });
      setMfaVerified();
      window.location.href = getPostAuthRedirect() || "/";
    } catch (err) {
      const message = err?.response?.data?.message || "Invalid code. Please try again.";
      setError(message);
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = () => {
    if (cooldown > 0 || sending) return;
    setCode("");
    requestCode();
  };

  const handleDifferentAccount = () => {
    clearMfaVerified();
    base44.auth.logout("/login");
  };

  return (
    <AuthLayout icon={ShieldCheck} title="Verify Your Identity" subtitle="Enter the 6-digit code we sent to your email">
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <div className="flex justify-center mb-4">
        <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus autoComplete="one-time-code" disabled={sending}>
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
        {expiresIn > 0 ? `Code expires in ${formatTime(expiresIn)}` : "Code expired — request a new one"}
      </p>

      <Button
        className="w-full h-12 font-medium"
        onClick={handleVerify}
        disabled={verifying || sending || code.length < 6}
      >
        {verifying ? (
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
          disabled={cooldown > 0 || sending}
          className="text-primary font-medium hover:underline disabled:text-muted-foreground disabled:no-underline"
        >
          {cooldown > 0 ? `Resend Code (${cooldown}s)` : "Resend Code"}
        </button>
      </p>

      <p className="text-center text-sm mt-2">
        <button onClick={handleDifferentAccount} className="text-muted-foreground hover:underline">
          Use a different account
        </button>
      </p>
    </AuthLayout>
  );
}