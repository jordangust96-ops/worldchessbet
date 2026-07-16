import React from "react";
import { CheckCircle2 } from "lucide-react";

// Automated, non-binding summary of investigation-relevant facts, derived
// from data already on the page. Never takes action on its own.
export default function SystemFindingsPanel({ facts, recommendedAction }) {
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        {facts.map((fact, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-white/70">
            <CheckCircle2 size={13} className="text-[#C9A84C] mt-0.5 shrink-0" />
            <span>{fact}</span>
          </div>
        ))}
      </div>
      {recommendedAction && (
        <div className="rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 p-3 mt-2">
          <p className="text-[10px] uppercase tracking-wider text-[#C9A84C]/70 mb-0.5">Recommended Action</p>
          <p className="text-sm font-semibold text-[#C9A84C]">{recommendedAction}</p>
        </div>
      )}
    </div>
  );
}