import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Shield, ShieldCheck, FileText, Scroll } from "lucide-react";

const legalLinks = [
  { to: "/privacy-policy", icon: Shield, label: "Privacy Policy" },
  { to: "/terms-of-service", icon: FileText, label: "Terms of Service" },
  { to: "/official-rules", icon: Scroll, label: "Official Rules" },
  { to: "/fair-play-integrity", icon: ShieldCheck, label: "Fair Play & Integrity" },
];

export default function LegalSection() {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-1">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Legal</p>
      {legalLinks.map(({ to, icon: Icon, label }) => (
        <Link
          key={to}
          to={to}
          className="flex items-center justify-between py-3 -mx-1 px-1 hover:bg-white/[0.03] rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <Icon size={16} className="text-white/40" />
            <span className="text-sm text-white">{label}</span>
          </div>
          <ChevronRight size={16} className="text-white/20" />
        </Link>
      ))}
    </div>
  );
}
