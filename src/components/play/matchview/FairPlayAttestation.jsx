import React from "react";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";

export default function FairPlayAttestation({ checked, onCheckedChange }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-2.5">
      <label className="flex items-start gap-3 cursor-pointer">
        <Checkbox
          checked={checked}
          onCheckedChange={onCheckedChange}
          className="mt-0.5 border-white/20 data-[state=checked]:bg-[#C9A84C] data-[state=checked]:border-[#C9A84C] data-[state=checked]:text-black"
        />
        <span className="text-xs leading-relaxed text-white/60">
          I certify that I will play this match fairly and without assistance from chess engines, AI,
          other people, or any external tools. I understand that violations of ChessBet's Fair Play
          Policy may result in match forfeiture, account suspension, or permanent removal from the
          platform. I have reviewed the Official Rules and I accept the Platform Service Fee shown
          above, charged separately from my Contest Entry Amount.
        </span>
      </label>
      <Link
        to="/fair-play-integrity"
        className="block text-[11px] text-[#C9A84C]/70 hover:text-[#C9A84C] underline underline-offset-2 pl-7"
      >
        Read our Fair Play & Integrity Policy
      </Link>
    </div>
  );
}