import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, BarChart3 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import SiteActivitySummary from "@/components/admin/SiteActivitySummary";
import SiteActivityTable from "@/components/admin/SiteActivityTable";

const ALLOWED_ADMIN_EMAIL = "jordangust96@gmail.com";

export default function AdminSiteActivity() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState([]);

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      if (me?.role !== "admin" || me?.email !== ALLOWED_ADMIN_EMAIL) {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      const { data } = await base44.functions.invoke("getSiteActivity", {});
      setDays(data.days || []);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  if (!authorized) {
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

  const today = days[days.length - 1];

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-4xl mx-auto">
      <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <BarChart3 size={18} className="text-[#C9A84C]" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-white">Site Activity</h1>
          <p className="text-xs text-white/40">Daily platform performance and usage</p>
        </div>
      </div>

      <div className="space-y-6">
        <SiteActivitySummary today={today} />
        <SiteActivityTable days={days} />
      </div>
    </div>
  );
}