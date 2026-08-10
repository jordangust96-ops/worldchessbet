import React, { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ArrowRight, BellRing } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function AdminActionAlert() {
  const location = useLocation();
  const [summary, setSummary] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const me = await base44.auth.me();
      if (me?.role !== "admin") {
        setSummary(null);
        return;
      }
      const response = await base44.functions.invoke("getAdminActionCenter", {});
      setSummary(response.data);
    } catch {
      // This alert must never block normal app navigation.
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(interval);
  }, [refresh, location.pathname]);

  if (!summary?.count) return null;

  const urgent = summary.urgent_count > 0;
  const topItem = summary.items?.[0];

  return (
    <div className="px-5 pt-5 max-w-3xl mx-auto">
      <div className={`rounded-2xl border p-4 ${urgent ? "border-red-500/35 bg-red-500/[0.09]" : "border-amber-400/30 bg-amber-400/[0.08]"}`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${urgent ? "bg-red-500/15" : "bg-amber-400/15"}`}>
            {urgent ? <AlertTriangle size={19} className="text-red-400" /> : <BellRing size={19} className="text-amber-300" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-white">
                {summary.count} admin {summary.count === 1 ? "action requires" : "actions require"} review
              </p>
              {urgent && (
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-300">
                  {summary.urgent_count} high priority
                </span>
              )}
            </div>
            {topItem && (
              <p className="mt-1 text-xs leading-5 text-white/60">
                Next: {topItem.recommendation}
              </p>
            )}
            <Link
              to="/admin/actions"
              className={`mt-3 inline-flex items-center gap-1.5 text-xs font-semibold ${urgent ? "text-red-300" : "text-amber-300"}`}
            >
              Open Admin Action Center <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
