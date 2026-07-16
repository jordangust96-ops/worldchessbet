import React from "react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { getJurisdictionMessage } from "@/lib/jurisdictionConfig";

// Shown whenever the current user's jurisdiction status (verified at login,
// and re-verified before every paid action) is anything other than
// 'approved'. Purely informational — actual enforcement always happens
// server-side.
export default function RestrictedModeBanner() {
  const { jurisdictionStatus, jurisdictionReason } = useAuth();
  if (!jurisdictionStatus || jurisdictionStatus === "approved") return null;

  const message = jurisdictionReason || getJurisdictionMessage(jurisdictionStatus);

  return (
    <div className="rounded-2xl bg-red-500/5 border border-red-500/20 p-4 flex gap-3 items-start">
      <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
      <p className="text-xs text-red-400/80 leading-relaxed whitespace-pre-line">{message}</p>
    </div>
  );
}