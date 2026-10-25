import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, WifiOff } from "lucide-react";
import { base44 } from "@/api/base44Client";

const WINDOWS = [
  { control: "Blitz (3+0)", seconds: 30 },
  { control: "Rapid (10+0)", seconds: 60 },
  { control: "Classical (15+0)", seconds: 90 },
];

export default function AdminGameSettings() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then((me) => {
      setIsAdmin(me?.role === "admin");
      setLoading(false);
    }).catch(() => {
      setIsAdmin(false);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0A] px-5 text-center">
        <p className="text-white font-semibold mb-2">Access Restricted</p>
        <p className="text-white/40 text-sm mb-4">You don't have permission to view this page.</p>
        <Link to="/profile" className="text-xs text-[#C9A84C] hover:underline">
          Back to Profile
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-2xl mx-auto">
      <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <WifiOff size={18} className="text-[#C9A84C]" />
        </div>
        <h1 className="text-xl font-extrabold text-white">Disconnect & Reconnect Rules</h1>
      </div>
      <p className="text-xs text-white/50 mb-6">
        Reconnect windows follow Chess.com's published time-control formula. They start only when the disconnected
        player is on move. A returning game heartbeat cancels the pending disconnect result; the chess clock keeps running.
      </p>

      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
        {WINDOWS.map((window) => (
          <div key={window.control} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
            <span className="text-sm text-white/70">{window.control}</span>
            <span className="text-sm font-semibold text-[#C9A84C]">{window.seconds} seconds</span>
          </div>
        ))}
        <p className="text-[11px] text-white/35 pt-2">
          Chess.com formula: 10% of base time plus 40 times the increment, with a 30-second minimum and 3-minute maximum.
          A short server-side confirmation follows the window to catch a returning heartbeat.
        </p>
      </div>
    </div>
  );
}
