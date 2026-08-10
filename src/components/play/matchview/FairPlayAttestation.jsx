import React from "react";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";

export default function FairPlayAttestation({ checked, disabled = false, onCheckedChange }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4 space-y-2.5">
      <label className={`flex items-start gap-3 ${disabled ? "cursor-default" : "cursor-pointer"}`}>
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange?.(value === true)}
          className="mt-0.5 border-white/20 data-[state=checked]:bg-[#C9A84C] data-[state=checked]:border-[#C9A84C] data-[state=checked]:text-black disabled:opacity-100"
        />
        <span className="text-xs leading-relaxed text-white/65">
          I agree to play without chess engines, AI, outside assistance, or other prohibited tools.
          I accept the Official Rules and the disclosed Platform Service Fee.
        </span>
      </label>

      <details className="group pl-7">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-[#C9A84C]/75 hover:text-[#C9A84C]">
          What am I agreeing to?
        </summary>
        <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-white/45">
          <p>
            This is a match-specific Fair Play certification. Violations may result in match
            forfeiture, account suspension, or permanent removal. The Platform Service Fee is
            separate from the Contest Entry Amount and is refunded if no decisive result occurs.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Link
              to="/fair-play-integrity"
              className="text-[#C9A84C]/70 underline underline-offset-2 hover:text-[#C9A84C]"
            >
              Fair Play & Integrity Policy
            </Link>
            <Link
              to="/official-rules"
              className="text-[#C9A84C]/70 underline underline-offset-2 hover:text-[#C9A84C]"
            >
              Official Rules
            </Link>
          </div>
        </div>
      </details>
    </div>
  );
}
