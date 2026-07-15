import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { base44 } from "@/api/base44Client";
import DisputeCaseRow from "@/components/disputes/DisputeCaseRow";
import { CASE_STATUS_LABELS } from "@/lib/reportCategories";

const STATUS_TABS = ["all", "open", "under_review", "awaiting_information", "resolved", "closed"];

export default function DisputeCaseQueue() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      if (me?.role !== "admin") {
        setLoading(false);
        return;
      }
      setIsAdmin(true);
      const rows = await base44.entities.DisputeCase.list("-created_date");
      setCases(rows);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = statusFilter === "all" ? cases : cases.filter((c) => c.status === statusFilter);

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
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-5xl mx-auto">
      <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <ShieldAlert size={18} className="text-[#C9A84C]" />
        </div>
        <h1 className="text-xl font-extrabold text-white">Dispute Cases</h1>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              statusFilter === tab ? "gold-gradient text-black" : "bg-white/[0.05] text-white/50 hover:text-white/80"
            }`}
          >
            {tab === "all" ? "All" : CASE_STATUS_LABELS[tab]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-white/30 text-center py-16">No cases found.</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-6 gap-3 px-4 text-[10px] uppercase tracking-wider text-white/30">
            <span>Case</span>
            <span>Priority</span>
            <span>Category</span>
            <span>Players</span>
            <span>Date</span>
            <span>Status</span>
          </div>
          {filtered.map((c) => (
            <DisputeCaseRow key={c.id} disputeCase={c} />
          ))}
        </div>
      )}
    </div>
  );
}