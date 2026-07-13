import React from "react";
import { Crown } from "lucide-react";

// Single source of truth for the ChessBet wordmark. Only the size varies by
// context (nav bar vs. hero) — font, weight, tracking, and color always match.
const SIZES = {
  sm: { icon: 18, text: "text-sm", gap: "gap-2" },
  md: { icon: 24, text: "text-lg", gap: "gap-2" },
  lg: { icon: 48, text: "text-5xl sm:text-6xl", gap: "gap-3" },
};

export default function Logo({ size = "sm", className = "" }) {
  const { icon, text, gap } = SIZES[size] || SIZES.sm;
  return (
    <div className={`flex items-center ${gap} ${className}`}>
      <Crown size={icon} strokeWidth={1.5} className="text-[#C9A84C]" />
      <span className={`${text} font-bold tracking-tight gold-text`}>ChessBet</span>
    </div>
  );
}