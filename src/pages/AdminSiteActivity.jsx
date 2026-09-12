import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, BarChart3, RefreshCw } from "lucide-react";
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
    { label: "Avg Session Duration", value: `${o.avgSessionDurationSeconds}s` },
    { label: "Bounce Rate", value: `${o.bounceRate}%` },
    { label: "Views", value: o.views },
    { label: "Unique Visitors", value: o.uniqueVisitors },
  ];
}

const usd = value => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
function buildInternalMetrics(i) {
  if (!i) return [];
  return [
    { label: "Registrations", value: i.registrations },
    { label: "Matches Hosted", value: i.matchesHosted },
    { label: "Matches Joined", value: i.matchesAccepted },
    { label: "Matches Declined", value: i.matchesDeclined },
    { label: "Matches Completed", value: i.matchesCompleted },
    { label: "Average Hosted Entry Amount", value: usd(i.avgWager) },
    { label: "Funded Entry Volume", value: usd(i.totalWagerVolume) },
    { label: "Average Challenge Wait", value: Math.round(i.avgMatchWaitSeconds / 60) + "m" },
  ];
}
function buildFundsMetrics(i) {
  return [
    { label: "Deposits Received", value: i.deposits },
    { label: "Deposit Principal Received", value: usd(i.depositVolume) },
    { label: "Deposit Returns", value: usd(i.depositReturns) },
    { label: "Deposits Released to Play", value: usd(i.depositsReleased) },
    { label: "Withdrawals Settled", value: i.withdrawalCount },
    { label: "Withdrawal Principal Settled", value: usd(i.withdrawalVolume) },
    { label: "Fee Credits", value: usd(i.feeCredits) },
    { label: "Fee Refunds / Reversals", value: usd(i.feeRefunds) },
    { label: "Net Platform Fee Revenue", value: usd(i.platformRevenue) },
    { label: "New Signup Deposit Conversion", value: i.depositConversion == null ? "—" : i.depositConversion + "%" },
    { label: "Failed Transfer Requests", value: i.failedTransfers },
  ];
}
function buildCurrentFunds(i) {
  return [
    { label: "Pending Deposits", value: i.pendingDeposits },
    { label: "Pending Deposit Principal", value: usd(i.pendingDepositVolume) },
    { label: "Deposits Held for Clearing", value: i.heldDeposits },
    { label: "Deposit Principal Held", value: usd(i.heldDepositVolume) },
    { label: "Pending Withdrawals", value: i.pendingWithdrawals },
    { label: "Pending Withdrawal Principal", value: usd(i.pendingWithdrawalVolume) },
    { label: "Transfers Needing Review", value: i.reviewTransfers },
    { label: "Player Available Balances", value: usd(i.availableBalance) },
    { label: "Player Held Balances", value: usd(i.heldBalance) },
    { label: "Net Fee Revenue Today (UTC)", value: usd(i.platformRevenueToday) },
    { label: "Active Games", value: i.activeGames },
  ];
}
function WalletSteps({ onboarding: o }) {
  if (!o) return null;
  return <section className="space-y-3" aria-label="Wallet onboarding">
    <h2 className="text-base font-bold text-white">Wallet onboarding</h2>
    <p className="text-xs text-white/50">Events in the selected UTC range. Repeat attempts count separately; completed-player counts are unique. Rejected decisions exclude technical failures and expired sessions.</p>
    <MetricCardGrid title="1 · Location verification" metrics={[
      {label:"Location Checks Accepted",value:o.locationAccepted},
      {label:"Location Checks Rejected",value:o.locationRejected},
      {label:"Location Checks Unresolved",value:o.locationUnresolved},
      {label:"Players Completing Location",value:o.locationCompletedUsers},
    ]} />
    <p className="text-xs text-white/40">Wallet setup checks only. Completed players include qualifying earlier approvals reused by wallet setup; gameplay checks and enforcement bypasses do not inflate new approvals.</p>
    <MetricCardGrid title="2 · ID verification" metrics={[
      {label:"ID Checks Accepted",value:o.idAccepted},
      {label:"ID Checks Rejected",value:o.idRejected},
      {label:"ID Checks Requiring Review",value:o.idReview},
      {label:"ID Checks Failed",value:o.idFailed},
      {label:"Players with ID Accepted",value:o.idVerifiedUsers},
      {label:"Expired ID Requests",value:o.idExpiredRequests},
    ]} />
    <p className="text-xs text-white/40">Production Socure decisions use completion time. Expired requests use request time.</p>
    <MetricCardGrid title="3 · Bank connection" metrics={[
      {label:"Bank Accounts Connected",value:o.banksConnected},
      {label:"Bank Accounts Verified",value:o.banksVerified},
    ]} />
    <p className="text-xs text-white/40">Connections use the account-added date, including accounts later disconnected. Verification uses the provider-confirmed verification date.</p>
    <MetricCardGrid title="Wallet setup · Current totals (all dates)" metrics={[
      {label:"Players with Location Complete",value:o.locationApprovedUsersNow},
      {label:"ID Checks Pending",value:o.idPendingNow},
      {label:"Connected Bank Accounts",value:o.banksConnectedNow},
      {label:"Verified Bank Accounts",value:o.banksVerifiedNow},
      {label:"Players with Verified Bank",value:o.bankUsersNow},
    ]} />
  </section>;
}

export default function AdminSiteActivity() {
  const [authorized, setAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const [preset, setPreset] = useState("7d");
  const [customStart, setCustomStart] = useState(new Date().toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));

  const fetchDashboard = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    setData(null);
    const payload = preset === "custom" ? { preset, startDate: customStart, endDate: customEnd } : { preset };
    try {
      const { data: res } = await base44.functions.invoke("getAnalyticsDashboard", payload);
      if (res?.error || !res?.internal) throw new Error(res?.error || "No complete reporting data was returned.");
      if (id === requestId.current) setData(res);
    } catch (err) {
      if (id === requestId.current) setError(err?.response?.data?.error || err?.message || "Unable to load Site Activity.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    const init = async () => {
      const me = await base44.auth.me().catch(() => null);
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
    return () => { requestId.current++; };
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
          <h1 className="text-xl font-extrabold text-white">Site Activity</h1>
          <p className="text-xs text-white/40">Site traffic, production funds, and wallet onboarding</p>
        </div>
      </div>

      <button type="button" disabled={loading} onClick={fetchDashboard} className="inline-flex items-center gap-2 mb-4 text-sm text-[#C9A84C] disabled:opacity-40"><RefreshCw size={14} /> Refresh</button>

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

      {error ? (
        <div role="alert" className="rounded-xl border border-red-400/30 p-5 text-sm text-red-300">
          <p>{error}</p>
          <button type="button" onClick={fetchDashboard} className="mt-3 underline">Try again</button>
        </div>
      ) : loading || !data ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
        </div>
      ) : (
        <div className="space-y-8">
          <p className="text-xs text-white/50">
            {data.range.startDate} to {data.range.endDate} · Platform dates: UTC · Updated {new Date(data.generatedAt).toLocaleString()}
          </p>
          <ConnectorStatusBanner connector={data.connector} />
          <p className="text-xs text-white/50">Traffic covers worldchessbet.com and www.worldchessbet.com. GA4 dates use {data.connector.timeZone || "the property's timezone"} and may update after a delay. Tracking blockers and visitors leaving before tracking loads can reduce recorded traffic.</p>
          {data.connector.dataWarnings?.map(warning => <p key={warning} className="text-xs text-amber-300">{warning}</p>)}
          {data.ga4 && <MetricCardGrid title="GA4 Overview" metrics={buildGa4Metrics(data.ga4)} />}
          <WalletSteps onboarding={data.onboarding} />
          <section className="space-y-3">
            <h2 className="text-base font-bold text-white">Funds activity</h2>
            <p className="text-xs text-white/50">Selected range · Production reporting starts September 9, 2026 at 22:59 UTC. Amounts come from complete ledger postings at posting time; deposit principal excludes processing fees. Fee revenue includes service and withdrawal fees, less refunds and reversals.</p>
            <MetricCardGrid metrics={buildFundsMetrics(data.internal)} />
            <p className="text-xs text-white/40">Deposit conversion is the share of users registered in this range who also had a deposit received in this range. Failed transfer requests are grouped by request date and current status.</p>
            <Link className="inline-block text-sm text-[#C9A84C] underline" to="/admin/transaction-ledger">Open transaction ledger</Link>
          </section>
          <section className="space-y-3">
            <h2 className="text-base font-bold text-white">Funds right now</h2>
            <p className="text-xs text-white/50">Current pipeline and wallet balances across all dates, independent of the selected range. Held balances include deposits, contest funds, pending winnings, and withdrawal holds. Wallet balances are the stored account balances; this report does not perform provider reconciliation.</p>
            <MetricCardGrid metrics={buildCurrentFunds(data.internal)} />
          </section>
          <MetricCardGrid title="Match activity · Selected range" metrics={buildInternalMetrics(data.internal)} />
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