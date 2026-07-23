import React, { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { trackPixelEvent } from "@/lib/metaPixel";

const STATE_STYLES = {
  provisional: "bg-white/10 text-white/60 border-white/10",
  verified: "bg-green-500/10 text-green-400 border-green-500/20",
  suspended: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  closed: "bg-red-500/10 text-red-400 border-red-500/20",
};

export default function AccountStateManager({ targetUser, onChanged }) {
  const [idNumber, setIdNumber] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [settingState, setSettingState] = useState(null);

  const accountState = targetUser?.account_state || "provisional";

  const setState = async (nextState) => {
    setSettingState(nextState);
    try {
      await base44.entities.User.update(targetUser.id, { account_state: nextState });
      onChanged?.();
    } finally {
      setSettingState(null);
    }
  };

  const runVerify = async () => {
    if (!idNumber.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    trackPixelEvent("Identity Verification Started", { user_id: targetUser.id });
    try {
      const res = await base44.functions.invoke("verifyUserIdentity", {
        userId: targetUser.id,
        idNumber: idNumber.trim(),
      });
      setVerifyResult(res.data);
      if (res.data?.success) {
        trackPixelEvent("Identity Verification Completed", { user_id: targetUser.id });
        setIdNumber("");
        onChanged?.();
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-bold text-white/80">Account State</p>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${STATE_STYLES[accountState]}`}
        >
          {accountState}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {["provisional", "suspended", "closed"].map((state) => (
          <Button
            key={state}
            size="sm"
            variant="outline"
            disabled={!!settingState || accountState === state}
            onClick={() => setState(state)}
            className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent capitalize"
          >
            {settingState === state && <Loader2 size={12} className="animate-spin mr-1" />}
            Set {state}
          </Button>
        ))}
      </div>

      <div className="pt-3 border-t border-white/5 space-y-2">
        <p className="text-xs font-semibold text-white/50">Complete Identity Verification</p>
        <p className="text-[11px] text-white/30">
          Enter the government ID number provided by the user. Each individual may hold only one Account
          — a match against an existing account's ID will deny this verification.
        </p>
        <div className="flex gap-2">
          <input
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            placeholder="ID number"
            className="flex-1 h-9 px-3 rounded-lg bg-white/[0.05] border border-white/10 text-white text-xs placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none"
          />
          <Button
            size="sm"
            disabled={verifying || !idNumber.trim()}
            onClick={runVerify}
            className="h-9 rounded-lg text-xs bg-[#C9A84C] text-black hover:bg-[#E8D48B]"
          >
            {verifying ? <Loader2 size={12} className="animate-spin mr-1" /> : <ShieldCheck size={12} className="mr-1" />}
            Verify
          </Button>
        </div>
        {verifyResult && (
          <p className={`text-xs ${verifyResult.success ? "text-green-400" : "text-red-400"}`}>
            {verifyResult.success ? "Identity verified — account is now Verified." : verifyResult.message || verifyResult.error}
          </p>
        )}
      </div>
    </div>
  );
}