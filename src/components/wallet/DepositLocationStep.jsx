import React, { useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { APPROVED_STATES } from "@/lib/jurisdictionConfig";
import { getRegionName } from "@/lib/jurisdictionRegions";
import JurisdictionWaitlistOptIn from "@/components/jurisdiction/JurisdictionWaitlistOptIn";
import WalletSetupStep from "./WalletSetupStep";

// One-time wallet onboarding. Approved evidence is saved on the server;
// opening the wallet or making another deposit never starts a location lookup.
export default function DepositLocationStep({ decision, onDecision }) {
  const { user } = useAuth();
  const [checking, setChecking] = useState(false);
  const inProgress = useRef(false);
  const approved = decision?.allowed === true;
  const hasResult = !!decision && decision.status !== "not_started" && !checking;
  const blocked = decision?.status === "blocked";
  const failed = hasResult && !approved;
  const resultTitle = blocked ? "Location not supported" : "Location verification failed";
  const checkLocation = async () => {
    if (approved || inProgress.current || !user?.id) return;
    inProgress.current = true;
    setChecking(true);
    try {
      const { data } = await base44.functions.invoke("verifyWalletOnboardingLocation", {});
      onDecision(data);
    } catch {
      onDecision({allowed:false, status:"verification_failed", reason:"We could not complete the location check. Please try again.", promptEligible:false});
    } finally {
      inProgress.current = false;
      setChecking(false);
    }
  };
  return (
    <WalletSetupStep number={1} label="Location verification"
      title={approved ? "Location Verified" : checking ? "Checking location" : "Location verification"}
      complete={approved} pending={checking} attention={failed}
      description={checking ? "Checking your connection. Please wait for the result." : hasResult ? null : "A one-time check before identity verification."}>
      {hasResult && !approved && (
        <div role="status" aria-live="polite" aria-atomic="true"
          className="mt-3 rounded-xl border border-amber-400/50 bg-amber-400/10 p-4 sm:p-5">
          <p className="text-lg font-bold leading-6 text-amber-200">{resultTitle}</p>
          <p className="mt-2 text-base font-medium leading-6 text-white">Wallet setup cannot continue until your location is approved.</p>
          <p className="mt-2 text-base leading-6 text-white/90">{decision.reason || "The location check did not complete. Please try again."}</p>
        </div>
      )}
      {!approved && (
        <button type="button" onClick={checkLocation} disabled={checking || !user?.id}
          className="mt-3 w-full rounded-xl gold-gradient px-4 py-3 text-sm font-semibold text-black disabled:opacity-40 sm:w-auto">
          {checking ? "Checking location…" : decision && decision.status !== "not_started" ? "Check location again" : "Verify location"}
        </button>
      )}
      {decision && decision.status !== "not_started" && !approved && (
        <div className="mt-4 space-y-3 text-sm leading-6 text-white/70">
          <p>Approved U.S. jurisdictions: {APPROVED_STATES.map(s => getRegionName(s) || s).join(", ")}.</p>
          {blocked && !checking && decision.promptEligible && <JurisdictionWaitlistOptIn key={`${decision.country}:${decision.state}`} userEmail={user?.email} initialCountry={decision.country} initialRegion={decision.state} />}
        </div>
      )}
    </WalletSetupStep>
  );
}
