import React, { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import AcceptPolicyPrompt from "@/components/legal/AcceptPolicyPrompt";
import { POLICY_TYPE_ORDER } from "@/lib/legalDocumentTypes";

// Sits inside MfaGuard: before rendering any protected page, checks whether
// the current user has accepted the latest active version of every legal
// document (Privacy Policy, Terms of Service, Official Rules). If not (new
// user edge case, or a policy was updated since their last acceptance),
// blocks navigation with an in-page prompt, one document at a time, until
// they've accepted all of them.
export default function PolicyAcceptanceGuard() {
  const [loading, setLoading] = useState(true);
  const [pendingQueue, setPendingQueue] = useState([]);

  useEffect(() => {
    check();
  }, []);

  const check = async () => {
    const me = await base44.auth.me();
    const pending = [];
    for (const policyType of POLICY_TYPE_ORDER) {
      const configs = await base44.entities.PrivacyPolicyConfig.filter(
        { is_active: true, policy_type: policyType },
        "-version",
        1
      );
      const active = configs?.[0];
      if (!active) continue;
      const acceptances = await base44.entities.PrivacyPolicyAcceptance.filter(
        { user_id: me.id, policy_version: active.version, policy_type: policyType },
        "-accepted_at",
        1
      );
      if (acceptances.length === 0) pending.push({ policyType, config: active });
    }
    setPendingQueue(pending);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0A0A0A]">
        <div className="w-8 h-8 border-4 border-white/10 border-t-[#C9A84C] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (pendingQueue.length > 0) {
    const current = pendingQueue[0];
    return (
      <AcceptPolicyPrompt
        config={current.config}
        policyType={current.policyType}
        onAccepted={() => setPendingQueue((prev) => prev.slice(1))}
      />
    );
  }

  return <Outlet />;
}