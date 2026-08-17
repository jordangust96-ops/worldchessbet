import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import Logo from "@/components/Logo";
import { base44 } from "@/api/base44Client";
import SEO from "@/components/seo/SEO";

export default function Unsubscribe() {
  const [status, setStatus] = useState("loading"); // loading | success | error

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const userId = params.get("userId");
      const token = params.get("token");
      if (!userId || !token) {
        setStatus("error");
        return;
      }
      try {
        await base44.functions.invoke("unsubscribeMarketingEmail", { userId, token });
        setStatus("success");
      } catch {
        setStatus("error");
      }
    };
    run();
  }, []);

  return (
    <>
    <SEO
      title="Email Preferences | ChessBet"
      description="Manage ChessBet email preferences."
      noindex
    />
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center px-6 text-center">
      <Link to="/" className="mb-8">
        <Logo size="md" />
      </Link>
      <div className="max-w-sm space-y-4">
        {status === "loading" && (
          <Loader2 className="animate-spin text-[#C9A84C] mx-auto" size={28} />
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="text-[#C9A84C] mx-auto" size={32} />
            <h1 className="text-lg font-bold text-white">You've been unsubscribed</h1>
            <p className="text-sm text-white/50">
              You won't receive any further marketing or announcement emails from ChessBet.
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="text-red-400 mx-auto" size={32} />
            <h1 className="text-lg font-bold text-white">Something went wrong</h1>
            <p className="text-sm text-white/50">
              We couldn't process your unsubscribe request. Please try again later.
            </p>
          </>
        )}
      </div>
    </div>
    </>
  );
}