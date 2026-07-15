import React from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ChevronRight, Lock } from "lucide-react";

export default function AdminToolsSection() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Lock size={12} className="text-[#C9A84C]" />
        <p className="text-[10px] font-semibold text-[#C9A84C] uppercase tracking-wider">
          Admin Tools — Not visible to standard users
        </p>
      </div>
      <div className="rounded-2xl bg-[#C9A84C]/[0.06] border border-[#C9A84C]/20 divide-y divide-[#C9A84C]/10 overflow-hidden">
        <Link to="/admin/disputes" className="flex items-center justify-between p-4 hover:bg-[#C9A84C]/[0.08] transition-colors">
          <div className="flex items-center gap-3">
            <ShieldAlert size={16} className="text-[#C9A84C]" />
            <span className="text-sm font-semibold text-white">Dispute Cases</span>
          </div>
          <ChevronRight size={16} className="text-white/20" />
        </Link>
        <Link to="/admin/game-settings" className="flex items-center justify-between p-4 hover:bg-[#C9A84C]/[0.08] transition-colors">
          <div className="flex items-center gap-3">
            <ShieldAlert size={16} className="text-[#C9A84C]" />
            <span className="text-sm font-semibold text-white">Game Settings</span>
          </div>
          <ChevronRight size={16} className="text-white/20" />
        </Link>
      </div>
    </div>
  );
}