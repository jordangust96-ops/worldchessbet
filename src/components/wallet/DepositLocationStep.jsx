import React, { useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { evaluateJurisdictionAccess, getJurisdictionCheck } from "@/lib/jurisdictionAccess";
import { APPROVED_STATES } from "@/lib/jurisdictionConfig";
import { getRegionName } from "@/lib/jurisdictionRegions";
import JurisdictionWaitlistOptIn from "@/components/jurisdiction/JurisdictionWaitlistOptIn";
import WalletSetupStep from "./WalletSetupStep";

// Browsing never starts a lookup. Only the explicit deposit button below
// checks location; identity and bank setup stay gated on its result.
export default function DepositLocationStep({ decision, onDecision, journey }) {
  const { user } = useAuth();
  const [checking, setChecking] = useState(false);
  const inProgress = useRef(false);
  const approved = decision?.allowed === true;
  const startDeposit = async () => {
    if (inProgress.current || !user?.id) return;
    inProgress.current = true;
    setChecking(true);
    try {
      const result = await getJurisdictionCheck(user.id, () =>
        base44.functions.invoke("getCurrentJurisdiction", { triggerEvent: "deposit_start" })
      );
      onDecision(evaluateJurisdictionAccess(result?.data ?? result));
    } catch {
      onDecision(evaluateJurisdictionAccess(null));
    } finally {
      inProgress.current = false;
      setChecking(false);
    }
  };
  return (
    <WalletSetupStep number={1} label="Location verification"
      title={approved ? "Location Verified" : checking ? "Checking location" : decision ? "Location verification required" : "Location check"}
      complete={approved} pending={checking}
      description={approved ? null : decision?.reason || journey?.locationDescription || "Check your current location before a new deposit."}>
      {!approved && (
        <button type="button" onClick={startDeposit} disabled={checking || !user?.id}
          className="mt-3 w-full rounded-xl gold-gradient px-4 py-3 text-sm font-semibold text-black disabled:opacity-40 sm:w-auto">
          {checking ? "Checking location…" : decision ? "Check location again" : journey?.locationAction || "Check location"}
        </button>
      )}
      {decision && !approved && (
        <div className="mt-3 space-y-3 text-xs text-white/60">
          <p>You can keep browsing and access your balance and withdrawals.</p>
          <p>Approved U.S. jurisdictions: {APPROVED_STATES.map(s => getRegionName(s) || s).join(", ")}.</p>
          {decision.promptEligible && <JurisdictionWaitlistOptIn userEmail={user?.email} />}
        </div>
      )}
    </WalletSetupStep>
  );
}
