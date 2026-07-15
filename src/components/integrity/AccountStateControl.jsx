import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

const STATES = [
  { value: "provisional", label: "Provisional" },
  { value: "verified", label: "Verified" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
];

const STATE_STYLES = {
  provisional: "bg-white/10 text-white/60 border-white/10",
  verified: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  suspended: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  closed: "bg-red-500/10 text-red-400 border-red-500/20",
};

export default function AccountStateControl({ targetUser, onChanged }) {
  const [saving, setSaving] = useState(false);
  const current = targetUser.account_state || "provisional";

  const handleChange = async (value) => {
    if (value === current || saving) return;
    setSaving(true);
    try {
      await base44.entities.User.update(targetUser.id, { account_state: value });
      onChanged(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl bg-white/[0.03] border border-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Account State</p>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${STATE_STYLES[current]}`}>
          {current}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {STATES.map((s) => (
          <button
            key={s.value}
            disabled={saving}
            onClick={() => handleChange(s.value)}
            className={`h-9 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 ${
              current === s.value
                ? "border-[#C9A84C]/40 bg-[#C9A84C]/10 text-[#C9A84C]"
                : "border-white/10 text-white/50 hover:text-white hover:bg-white/5"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {saving && (
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-white/30">
          <Loader2 size={10} className="animate-spin" /> Saving...
        </div>
      )}
    </div>
  );
}