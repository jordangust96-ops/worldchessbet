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
      title={approved ? "Location Verified" : checking ? "Checking location" : decision?.status === "blocked" ? "Location not approved" : "Verify your location"}
      complete={approved} pending={checking}
      description={approved ? null : decision?.reason || "A one-time check before identity verification."}>
      {!approved && (
        <button type="button" onClick={checkLocation} disabled={checking || !user?.id}
          className="mt-3 w-full rounded-xl gold-gradient px-4 py-3 text-sm font-semibold text-black disabled:opacity-40 sm:w-auto">
          {checking ? "Checking location…" : decision && decision.status !== "not_started" ? "Check location again" : "Verify location"}
        </button>
      )}
      {decision && decision.status !== "not_started" && !approved && (
        <div className="mt-3 space-y-3 text-xs text-white/60">
          <p>You can keep browsing and access your balance and withdrawals.</p>
          <p>Approved U.S. jurisdictions: {APPROVED_STATES.map(s => getRegionName(s) || s).join(", ")}.</p>
          {decision.promptEligible && <JurisdictionWaitlistOptIn userEmail={user?.email} />}
        </div>
      )}
    </WalletSetupStep>
  );
}
