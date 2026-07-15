import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Shield, ShieldCheck, FileText, Settings, ShieldAlert } from "lucide-react";

export default function LegalSection({ isAdmin }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-1">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Legal</p>

      <Link
        to="/privacy-policy"
        className="flex items-center justify-between py-3 -mx-1 px-1 hover:bg-white/[0.03] rounded-xl transition-colors">
        
        <div className="flex items-center gap-3">
          <Shield size={16} className="text-white/40" />
          <span className="text-sm text-white">Privacy Policy</span>
        </div>
        <ChevronRight size={16} className="text-white/20" />
      </Link>

      <Link
        to="/fair-play-integrity"
        className="flex items-center justify-between py-3 -mx-1 px-1 hover:bg-white/[0.03] rounded-xl transition-colors">
        
        <div className="flex items-center gap-3">
          <ShieldCheck size={16} className="text-white/40" />
          <span className="text-sm text-white">Fair Play & Integrity</span>
        </div>
        <ChevronRight size={16} className="text-white/20" />
      </Link>

      

      {isAdmin &&
      <Link
        to="/admin/privacy-policy"
        className="flex items-center justify-between py-3 -mx-1 px-1 hover:bg-white/[0.03] rounded-xl transition-colors">
        
          <div className="flex items-center gap-3">
            <Settings size={16} className="text-[#C9A84C]/60" />
            <span className="text-sm text-[#C9A84C]/80">Manage Privacy Policy</span>
          </div>
          <ChevronRight size={16} className="text-white/20" />
        </Link>
      }

      {isAdmin &&
      <Link
        to="/admin/integrity"
        className="flex items-center justify-between py-3 -mx-1 px-1 hover:bg-white/[0.03] rounded-xl transition-colors">
        
          <div className="flex items-center gap-3">
            <ShieldAlert size={16} className="text-[#C9A84C]/60" />
            <span className="text-sm text-[#C9A84C]/80">Integrity Review Queue</span>
          </div>
          <ChevronRight size={16} className="text-white/20" />
        </Link>
      }
    </div>);

}