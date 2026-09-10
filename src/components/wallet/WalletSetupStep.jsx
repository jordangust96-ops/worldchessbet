import React from "react";
import { Check, Clock, AlertTriangle } from "lucide-react";

// Display only: callers keep the existing authoritative eligibility checks.
export default function WalletSetupStep({ number, title, complete = false, pending = false, attention = false, description, children, label }) {
  const Icon = complete ? Check : pending ? Clock : attention ? AlertTriangle : null;
  return <section aria-label={label || title} className="px-4 py-4 sm:px-5">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold " + (complete ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-400" : pending || attention ? "border-amber-400/25 bg-amber-400/10 text-amber-300" : "border-white/15 bg-white/5 text-white/50")}>
        {Icon ? <Icon size={18} strokeWidth={2.5} /> : number}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <h3 role="status" aria-live="polite" className={"text-sm font-semibold leading-5 " + (complete ? "text-emerald-300" : "text-white")}>{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-white/60">{description}</p>}
        {children}
      </div>
    </div>
  </section>;
}
