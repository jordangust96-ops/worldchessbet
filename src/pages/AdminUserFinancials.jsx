import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Wallet as WalletIcon, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";

// Builder-facing (admin) view of each user's lifetime wagering activity:
// wallet balance, amount wagered, amount won, amount lost, and total
// platform service fees paid. Not a user-facing feature.
export default function AdminUserFinancials() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const me = await base44.auth.me();
    if (me?.role !== "admin") {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);
    const res = await base44.functions.invoke("getUserFinancialOverview", {});
    setRows(res.data?.rows || []);
    setLoading(false);
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.full_name?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const formatUsd = (n) => `$${(n || 0).toFixed(2)}`;

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

      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <WalletIcon size={18} className="text-[#C9A84C]" />
        </div>
        <h1 className="text-xl font-extrabold text-white">User Financial Overview</h1>
      </div>
      <p className="text-xs text-white/40 mb-5">
        Lifetime wagering activity per user \u2014 wallet balance, amount wagered, amount won, amount lost, and total
        platform service fees paid.
      </p>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          className="bg-white/[0.03] border-white/10 text-white pl-9"
        />
      </div>

      <div className="rounded-2xl bg-white/[0.03] border border-white/5 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-white/40 border-b border-white/5">
              <th className="p-3 font-semibold">User</th>
              <th className="p-3 font-semibold text-right">Wallet Balance</th>
              <th className="p-3 font-semibold text-right">Amount Wagered</th>
              <th className="p-3 font-semibold text-right">Amount Won</th>
              <th className="p-3 font-semibold text-right">Amount Lost</th>
              <th className="p-3 font-semibold text-right">Platform Fees</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-b border-white/5 last:border-0">
                <td className="p-3">
                  <p className="text-white font-medium">{r.full_name || "\u2014"}</p>
                  <p className="text-white/40 text-xs">{r.email}</p>
                </td>
                <td className="p-3 text-right text-white">{formatUsd(r.wallet_balance)}</td>
                <td className="p-3 text-right text-white/80">{formatUsd(r.amount_wagered)}</td>
                <td className="p-3 text-right text-emerald-400">{formatUsd(r.amount_won)}</td>
                <td className="p-3 text-right text-red-400">{formatUsd(r.amount_lost)}</td>
                <td className="p-3 text-right text-[#C9A84C]">{formatUsd(r.total_platform_fees)}</td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-white/30 text-sm">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}