import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, BarChart3 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import TimeRangeFilter from "@/components/admin/analytics/TimeRangeFilter";
import ConnectorStatusBanner from "@/components/admin/analytics/ConnectorStatusBanner";
import MetricCardGrid from "@/components/admin/analytics/MetricCardGrid";
import AcquisitionPanel from "@/components/admin/analytics/AcquisitionPanel";
import GeographyPanel from "@/components/admin/analytics/GeographyPanel";
import DevicesPanel from "@/components/admin/analytics/DevicesPanel";
import PagesPanel from "@/components/admin/analytics/PagesPanel";
import FunnelPanel from "@/components/admin/analytics/FunnelPanel";
import AnalyticsCharts from "@/components/admin/analytics/AnalyticsCharts";

const ALLOWED_ADMIN_EMAIL = "jordangust96@gmail.com";

function buildGa4Metrics(ga4) {
  if (!ga4) return [];
  const o = ga4.overview;
  return [
    { label: "Total Users", value: o.totalUsers },
    { label: "Active Users", value: o.activeUsers },
    { label: "New Users", value: o.newUsers },
    { label: "Sessions", value: o.sessions },
    { label: "Engaged Sessions", value: o.engagedSessions },
    { label: "Avg Engagement Time", value: `${o.avgEngagementTimeSeconds}s` },
    { label: "Bounce Rate", value: `${o.bounceRate}%` },
    { label: "Views", value: o.views },
    { label: "Unique Visitors", value: o.uniqueVisitors },
    { label: "Returning Visitors", value: o.returningVisitors },
  ];
}

function buildInternalMetrics(internal) {
  if (!internal) return [];
  return [
    { label: "Registrations", value: internal.registrations },
    { label: "Verified Users", value: internal.verifiedUsers },
    { label: "Deposits", value: internal.deposits },
    { label: "Deposit Volume", value: `$${internal.depositVolume.toFixed(2)}` },
    { label: "Deposit Conversion", value: `${internal.depositConversion}%` },
    { label: "Matches Hosted", value: internal.matchesHosted },
    { label: "Matches Accepted", value: internal.matchesAccepted },
    { label: "Matches Declined", value: internal.matchesDeclined },
    { label: "Matches Completed", value: internal.matchesCompleted },
    { label: "Active Games", value: internal.activeGames },
    { label: "Average Wager", value: `$${internal.avgWager.toFixed(2)}` },
    { label: "Total Wager Volume", value: `$${internal.totalWagerVolume.toFixed(2)}` },
    { label: "Platform Revenue", value: `$${internal.platformRevenue.toFixed(2)}` },
    { label: "Today's Platform Fee Earned", value: `$${internal.todaysPlatformFeeEarned.toFixed(2)}` },
    { label: "Avg Match Wait Time", value: `${Math.round(internal.avgMatchWaitSeconds / 60)}m` },
  ];
}

export default function AdminSiteActivity() {
  const [authorized, setAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [preset, setPreset] = useState("7d");
  const [customStart, setCustomStart] = useState(new Date().toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    const payload = preset === "custom" ? { preset, startDate: customStart, endDate: customEnd } : { preset };
    const { data: res } = await base44.functions.invoke("getAnalyticsDashboard", payload);
    setData(res);
    setLoading(false);
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    const init = async () => {
      const me = await base44.auth.me();
      if (me?.role !== "admin" || me?.email !== ALLOWED_ADMIN_EMAIL) {
        setAuthorized(false);
        setCheckingAuth(false);
        return;
      }
      setAuthorized(true);
      setCheckingAuth(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (authorized) fetchDashboard();
  }, [authorized, fetchDashboard]);

  if (checkingAuth) {
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

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-5xl mx-auto">
      <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <BarChart3 size={18} className="text-[#C9A84C]" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-white">Analytics Dashboard</h1>
          <p className="text-xs text-white/40">GA4 traffic combined with ChessBet platform metrics</p>
        </div>
      </div>

      <TimeRangeFilter
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={setPreset}
        onCustomChange={(s, e) => {
          setCustomStart(s);
          setCustomEnd(e);
        }}
      />

      {loading || !data ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
        </div>
      ) : (
        <div className="space-y-8">
          <ConnectorStatusBanner connector={data.connector} />
          {data.ga4 && <MetricCardGrid title="GA4 Overview" metrics={buildGa4Metrics(data.ga4)} />}
          <MetricCardGrid title="Platform Metrics" metrics={buildInternalMetrics(data.internal)} />
          {data.ga4 && (
            <>
              <AcquisitionPanel acquisition={data.ga4.acquisition} />
              <GeographyPanel geography={data.ga4.geography} />
              <DevicesPanel devices={data.ga4.devices} />
              <PagesPanel pages={data.ga4.pages} />
            </>
          )}
          <FunnelPanel funnel={data.funnel} />
          <AnalyticsCharts charts={data.charts} />
        </div>
      )}
    </div>
  );
}