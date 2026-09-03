import React, { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import moment from "moment";
import { ArrowLeft, Loader2, ShieldAlert, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { invokeAdminFunction } from "@/lib/adminApi";
import IntegrityFlagCard from "@/components/integrity/IntegrityFlagCard";
import NewIntegrityFlagForm from "@/components/integrity/NewIntegrityFlagForm";
import AccountStateManager from "@/components/integrity/AccountStateManager";
import AccountStateControl from "@/components/integrity/AccountStateControl";
import JurisdictionPanel from "@/components/integrity/JurisdictionPanel";
import FairPlayScreeningGuidance from "@/components/integrity/FairPlayScreeningGuidance";

function formatMetric(value, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatRate(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

export default function AdminUserIntegrity() {
  const { userId } = useParams();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [targetUser, setTargetUser] = useState(null);
  const [flags, setFlags] = useState([]);
  const [matches, setMatches] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [jurisdictionLogs, setJurisdictionLogs] = useState([]);
  const [fairPlayAnalyses, setFairPlayAnalyses] = useState([]);
  const [retryingAnalysisId, setRetryingAnalysisId] = useState(null);
  const [retryError, setRetryError] = useState("");
  const [showNewFlag, setShowNewFlag] = useState(false);

  useEffect(() => {
    load();
  }, [userId]);

  const load = async () => {
    const me = await base44.auth.me();
    if (me?.role !== "admin") {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);

    const [u, userFlags, asP1, asP2, txs, jurisdictionHistory] = await Promise.all([
      base44.entities.User.get(userId).catch(() => null),
      base44.entities.IntegrityFlag.filter({ user_id: userId }, "-created_date"),
      base44.entities.Match.filter({ player1_id: userId }, "-created_date", 25),
      base44.entities.Match.filter({ player2_id: userId }, "-created_date", 25),
      base44.entities.WalletTransaction.filter({ user_id: userId }, "-created_date", 25),
      base44.entities.JurisdictionVerificationLog.filter({ user_id: userId }, "-created_date", 25),
    ]);

    setTargetUser(u);
    setFlags(userFlags);
    setMatches(
      [...asP1, ...asP2].sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime()).slice(0, 20)
    );
    setTransactions(txs);
    setJurisdictionLogs(jurisdictionHistory);
    const playerMatchIds = new Set([...asP1, ...asP2].map((match) => match.id));
    const playerColorByMatchId = new Map();
    asP1.forEach((match) => playerColorByMatchId.set(match.id, "white"));
    asP2.forEach((match) => playerColorByMatchId.set(match.id, "black"));
    // Scoped per-match, not a global recency-capped list-then-filter — a
    // global FairPlayAnalysis.list() capped at N records silently drops this
    // player's older analyses once platform-wide volume passes that cap.
    // Querying by this player's own match IDs has no such ceiling.
    const fairPlayRecords = (
      await Promise.all(
        [...playerMatchIds].map((matchId) => base44.entities.FairPlayAnalysis.filter({ match_id: matchId }))
      )
    ).flat();
    const playerFairPlayAnalyses = /** @type {any[]} */ (
      fairPlayRecords.map((analysis) => ({ ...analysis, reviewed_player_color: playerColorByMatchId.get(analysis.match_id) }))
    );
    setFairPlayAnalyses(
      playerFairPlayAnalyses
        .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())
        .slice(0, 20)
    );
    setLoading(false);
  };

  const retryFairPlayAnalysis = async (analysis) => {
    setRetryingAnalysisId(analysis.id);
    setRetryError("");
    try {
      await invokeAdminFunction("requestFairPlayAnalysis", {
        matchId: analysis.match_id,
        gameId: analysis.game_id,
        force: analysis.status === "completed" || analysis.status === "manual_review",
      });
      await load();
    } catch (error) {
      setRetryError(
        error?.response?.data?.error || error?.message || "The Fair Play analysis retry failed."
      );
    } finally {
      setRetryingAnalysisId(null);
    }
  };

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openNewFlagFromGuidance = () => {
    setShowNewFlag(true);
    window.requestAnimationFrame(() => scrollToSection("current-risk-flags"));
  };

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

  const currentFlags = flags.filter((f) => f.status === "open" || f.status === "under_review");
  const previousFlags = flags.filter((f) => f.status === "cleared" || f.status === "action_taken");
  const chargebackFlags = flags.filter((f) => f.flag_type === "chargeback");
  const deposits = transactions.filter((t) => t.type === "deposit");
  const withdrawals = transactions.filter((t) => t.type === "withdrawal");

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-2xl mx-auto">
      <Link to="/admin/integrity" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Integrity Review Queue
      </Link>

      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
            <ShieldAlert size={18} className="text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-white">{targetUser?.full_name || targetUser?.email || userId}</h1>
            <p className="text-xs text-white/40">{targetUser?.email}</p>
          </div>
        </div>
        {targetUser?.withdrawal_hold && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border bg-red-500/10 text-red-400 border-red-500/20">
            Withdrawals On Hold
          </span>
        )}
      </div>

      {targetUser && (
        <AccountStateControl
          targetUser={targetUser}
          onChanged={(account_state) => setTargetUser((u) => ({ ...u, account_state }))}
        />
      )}

      <div className="mt-6">
        <AccountStateManager targetUser={targetUser} onChanged={load} />
      </div>

      <div className="mt-6">
        <JurisdictionPanel targetUser={targetUser} logs={jurisdictionLogs} />
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-bold text-white/80">Automated Fair Play Screening</h2>
        <p className="mt-1 mb-3 text-xs leading-5 text-white/35">
          Start with the latest disposition and recommended action. Technical metrics remain available below as supporting evidence.
        </p>
        <FairPlayScreeningGuidance
          analysis={fairPlayAnalyses[0]}
          reviewedPlayerColor={fairPlayAnalyses[0]?.reviewed_player_color}
          hasOpenFlag={currentFlags.length > 0}
          onCreateFlag={openNewFlagFromGuidance}
          onReviewFlags={() => scrollToSection("current-risk-flags")}
          onReviewContests={() => scrollToSection("related-contests")}
        />
        {fairPlayAnalyses.length > 0 && (
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-white/30">
            Screening history & technical evidence
          </p>
        )}
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 divide-y divide-white/5">
          {fairPlayAnalyses.length === 0 ? (
            <p className="text-xs text-white/30 p-4">No completed-game screening records yet.</p>
          ) : (
            fairPlayAnalyses.map((analysis) => {
              const isWhite = analysis.reviewed_player_color === "white";
              const band = isWhite ? analysis.white_risk_band : analysis.black_risk_band;
              const score = isWhite ? analysis.white_risk_score : analysis.black_risk_score;
              const status = analysis.status?.replace(/_/g, " ") || "queued";
              const analyzedMoves = isWhite ? analysis.white_eligible_moves : analysis.black_eligible_moves;
              const side = isWhite ? "white" : "black";
              const averageCpl = analysis[`${side}_average_centipawn_loss`];
              const medianCpl = analysis[`${side}_median_centipawn_loss`];
              const averageMoveTime = analysis[`${side}_average_move_time_ms`];
              const top1MatchRate = analysis[`${side}_top_1_match_rate`];
              const top3MatchRate = analysis[`${side}_top_3_match_rate`];
              const timingSampleCount = analysis[`${side}_timing_sample_count`];
              const cplSampleCount = analysis[`${side}_centipawn_loss_sample_count`];
              const rankedEngineMoveSampleCount = analysis[`${side}_ranked_engine_move_sample_count`];
              const criticalPositionCount = analysis[`${side}_critical_position_count`];
              const canRetry = ["failed", "awaiting_analyzer", "completed", "manual_review"].includes(analysis.status);
              const retryLabel = analysis.status === "completed" || analysis.status === "manual_review" ? "Reanalyze" : "Retry";
              return (
                <div key={analysis.id} className="p-3 text-xs flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white/60 capitalize">{status}</p>
                    <p className="text-white/30 mt-0.5">{moment(analysis.created_date).format("MMM D, YYYY h:mm A")}</p>
                    {typeof analysis.analyzer_version === "string" && analysis.analyzer_version && (
                      <p className="text-white/30 mt-0.5">Analyzer v{analysis.analyzer_version} · {analysis.stockfish_version || "engine unavailable"} · depth {formatMetric(analysis.analysis_depth)}</p>
                    )}
                    {typeof analysis.eligible_move_count === "number" && (
                      <p className="text-white/30 mt-0.5">{analysis.eligible_move_count} eligible engine positions</p>
                    )}
                    {typeof analyzedMoves === "number" && <p className="text-white/30 mt-0.5">{analyzedMoves} analyzed moves</p>}
                    {analysis.status === "completed" || analysis.status === "manual_review" ? (
                      <>
                        <p className="text-white/30 mt-0.5">CPL avg/median {formatMetric(averageCpl, 1)} / {formatMetric(medianCpl, 1)} · move time {formatMetric(averageMoveTime)} ms</p>
                        <p className="text-white/30 mt-0.5">Top-1/Top-3 {formatRate(top1MatchRate)} / {formatRate(top3MatchRate)}</p>
                        <p className="text-white/30 mt-0.5">Coverage: timing {formatMetric(timingSampleCount)}, CPL {formatMetric(cplSampleCount)}, ranked {formatMetric(rankedEngineMoveSampleCount)}, critical {formatMetric(criticalPositionCount)}</p>
                      </>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className={band === "review" ? "text-red-400 font-semibold capitalize" : band === "monitor" ? "text-amber-400 font-semibold capitalize" : "text-white/50 capitalize"}>
                        {band?.replace(/_/g, " ") || "pending"}
                      </p>
                      {typeof score === "number" && <p className="text-white/30 mt-0.5">Score {score}</p>}
                    </div>
                    {canRetry && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryingAnalysisId === analysis.id}
                        onClick={() => retryFairPlayAnalysis(analysis)}
                        className="h-7 rounded-lg text-[10px] border-white/10 text-white/60 hover:text-white bg-transparent"
                      >
                        {retryingAnalysisId === analysis.id ? (
                          <Loader2 size={11} className="animate-spin mr-1" />
                        ) : (
                          <RotateCcw size={11} className="mr-1" />
                        )}
                        {retryLabel}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {retryError && <p className="text-xs text-red-400/80 mt-2">{retryError}</p>}
      </div>

      <div id="current-risk-flags" className="mt-6 flex items-center justify-between scroll-mt-6">
        <h2 className="text-sm font-bold text-white/80">Current Risk Flags</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowNewFlag((v) => !v)}
          className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
        >
          <Plus size={12} className="mr-1" /> New Flag
        </Button>
      </div>

      {showNewFlag && (
        <div className="mt-3">
          <NewIntegrityFlagForm
            userId={userId}
            onCreated={() => {
              setShowNewFlag(false);
              load();
            }}
          />
        </div>
      )}

      <div className="mt-3 space-y-2.5">
        {currentFlags.length === 0 ? (
          <p className="text-xs text-white/30">No open flags.</p>
        ) : (
          currentFlags.map((flag) => (
            <IntegrityFlagCard key={flag.id} flag={flag} withdrawalHold={!!targetUser?.withdrawal_hold} onChanged={load} />
          ))
        )}
      </div>

      <h2 className="text-sm font-bold text-white/80 mt-7 mb-3">Previous Flags</h2>
      <div className="space-y-2.5">
        {previousFlags.length === 0 ? (
          <p className="text-xs text-white/30">No resolved flags yet.</p>
        ) : (
          previousFlags.map((flag) => (
            <IntegrityFlagCard key={flag.id} flag={flag} withdrawalHold={!!targetUser?.withdrawal_hold} onChanged={load} />
          ))
        )}
      </div>

      <h2 id="related-contests" className="text-sm font-bold text-white/80 mt-7 mb-3 scroll-mt-6">Related Contests</h2>
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 divide-y divide-white/5">
        {matches.length === 0 ? (
          <p className="text-xs text-white/30 p-4">No contests found.</p>
        ) : (
          matches.map((m) => (
            <div key={m.id} className="p-3 flex items-center justify-between text-xs">
              <span className="text-white/60">
                {moment(m.created_date).format("MMM D, YYYY")} · ${m.wager_amount?.toFixed?.(2) ?? m.wager_amount}
              </span>
              <span className="text-white/40">{m.status}</span>
            </div>
          ))
        )}
      </div>

      <h2 className="text-sm font-bold text-white/80 mt-7 mb-3">Chargebacks</h2>
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4">
        <p className="text-xs text-white/40">
          {chargebackFlags.length === 0 ? "No chargebacks on record." : `${chargebackFlags.length} chargeback flag(s) on record.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-7">
        <div>
          <h2 className="text-sm font-bold text-white/80 mb-3">Recent Withdrawals</h2>
          <div className="rounded-2xl bg-white/[0.03] border border-white/5 divide-y divide-white/5">
            {withdrawals.length === 0 ? (
              <p className="text-xs text-white/30 p-4">None.</p>
            ) : (
              withdrawals.map((t) => (
                <div key={t.id} className="p-3 text-xs">
                  <p className="text-white/60">${t.amount?.toFixed?.(2) ?? t.amount}</p>
                  <p className="text-white/30">{moment(t.created_date).format("MMM D, YYYY")}</p>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-bold text-white/80 mb-3">Recent Deposits</h2>
          <div className="rounded-2xl bg-white/[0.03] border border-white/5 divide-y divide-white/5">
            {deposits.length === 0 ? (
              <p className="text-xs text-white/30 p-4">None.</p>
            ) : (
              deposits.map((t) => (
                <div key={t.id} className="p-3 text-xs">
                  <p className="text-white/60">${t.amount?.toFixed?.(2) ?? t.amount}</p>
                  <p className="text-white/30">{moment(t.created_date).format("MMM D, YYYY")}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}