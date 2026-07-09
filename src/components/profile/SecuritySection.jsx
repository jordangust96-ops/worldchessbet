import React from "react";
import { ShieldCheck, Mail, Clock } from "lucide-react";

export default function SecuritySection({ email }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-4">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Security</p>

      <div className="flex items-center gap-3">
        <ShieldCheck size={16} className="text-[#C9A84C]" />
        <div>
          <p className="text-[10px] text-white/30 uppercase">MFA Status</p>
          <p className="text-sm text-white">Enabled</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Mail size={16} className="text-white/30" />
        <div>
          <p className="text-[10px] text-white/30 uppercase">Verified Email</p>
          <p className="text-sm text-white">{email || "—"}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Clock size={16} className="text-white/30" />
        <div>
          <p className="text-[10px] text-white/30 uppercase">Last MFA Verification</p>
          <p className="text-sm text-white">This session</p>
        </div>
      </div>
    </div>
  );
}