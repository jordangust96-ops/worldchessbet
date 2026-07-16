import React, { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import DisputeCaseTimeline from "@/components/disputes/DisputeCaseTimeline";
import DisputeCaseActions from "@/components/disputes/DisputeCaseActions";
import FinancialResolutionPanel from "@/components/disputes/FinancialResolutionPanel";
import PlayerWalletCard from "@/components/disputes/PlayerWalletCard";
import LedgerEntriesPanel from "@/components/disputes/LedgerEntriesPanel";
import MatchReplay from "@/components/disputes/MatchReplay";
import SystemFindingsPanel from "@/components/disputes/SystemFindingsPanel";
import RelatedUserHistoryPanel from "@/components/disputes/RelatedUserHistoryPanel";
import { buildSystemFindings } from "@/lib/disputeFindings";
import { CASE_STATUS_LABELS } from "@/lib/reportCategories";

function Card({ title, children }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 mb-4">
      <p className="text-xs font-semibold text-white/70 uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  );
}

export default function AdminDisputeCase() {
  const { caseId } = useParams();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [disputeCase, setDisputeCase] = useState(null);
  const [notes, setNotes] = useState([]);
  const [priorReports, setPriorReports] = useState([]);
  const [financials, setFinancials] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const me = await base44.auth.me();
      if (me?.role !== "admin") {
        setLoading(false);
        return;
      }
      setIsAdmin(true);

      const [caseRecord, caseNotes] = await Promise.all([
        base44.entities.DisputeCase.get(caseId),
        base44.entities.DisputeCaseNote.filter({ case_id: caseId }, "created_date"),
      ]);
      setDisputeCase(caseRecord);
      setNotes(caseNotes);

      const [byReporter, byReported, overviewRes] = await Promise.all([
        base44.entities.DisputeCase.filter({ reporting_user_id: caseRecord.reporting_user_id }),
        caseRecord.reported_user_id
          ? base44.entities.DisputeCase.filter({ reported_user_id: caseRecord.reported_user_id })
          : Promise.resolve([]),
        base44.functions.invoke("getCaseFinancialOverview", { caseId }),
      ]);
      const priorMap = new Map();
      [...byReporter, ...byReported].forEach((c) => {
        if (c.id !== caseId) priorMap.set(c.id, c);
      });
      setPriorReports(Array.from(priorMap.values()));
      setFinancials(overviewRes.data);
    } catch (err) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  if (!isAdmin || !disputeCase || loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0A] px-5 text-center">
        <p className="text-white font-semibold mb-2">
          {!isAdmin ? "Access Restricted" : loadError ? "Something went wrong loading this case" : "Case Not Found"}
        </p>
        {loadError && (
          <button onClick={load} className="text-xs text-[#C9A84C] hover:underline mb-3">
            Try Again
          </button>
        )}
        <Link to="/admin/disputes" className="text-xs text-[#C9A84C] hover:underline">
          Back to Dispute Cases
        </Link>
      </div>
    );
  }

  const { facts, recommendedAction } = buildSystemFindings({
    disputeCase,
    match: financials?.match,
    game: financials?.game,
    contestRecord: financials?.contestRecord,
  });

  const fundsRecoverable = financials?.contestRecord
    ? !(financials.reportingPlayer?.withdrawalsAfterSettlement || financials.reportedPlayer?.withdrawalsAfterSettlement)
    : true;

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-3xl mx-auto">
      <Link to="/admin/disputes" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Dispute Cases
      </Link>

      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-extrabold text-white">Case #{disputeCase.case_number}</h1>
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-white/10 text-white/60">
          {CASE_STATUS_LABELS[disputeCase.status]}
        </span>
      </div>
      <p className="text-xs text-white/40 mb-6">
        {disputeCase.report_category?.replace("_", " ")}
        {disputeCase.report_subcategory ? ` · ${disputeCase.report_subcategory}` : ""} · Priority: {disputeCase.priority}
      </p>

      <Card title="Report Details">
        <p className="text-sm text-white/80 whitespace-pre-wrap">{disputeCase.report_description}</p>
      </Card>

      <Card title="Contest Information">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-white/30">Reporting User</p>
            <p className="text-white/80 font-semibold">{disputeCase.reporting_user_username}</p>
          </div>
          <div>
            <p className="text-white/30">Reported User</p>
            <p className="text-white/80 font-semibold">{disputeCase.reported_user_username || "—"}</p>
          </div>
          <div>
            <p className="text-white/30">Time Control</p>
            <p className="text-white/80 font-semibold">{disputeCase.display_name || disputeCase.time_control}</p>
          </div>
          <div>
            <p className="text-white/30">Entry Amount</p>
            <p className="text-white/80 font-semibold">${(disputeCase.entry_amount || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-white/30">Outcome</p>
            <p className="text-white/80 font-semibold">{disputeCase.outcome_type || "In progress"}</p>
          </div>
          <div>
            <p className="text-white/30">Match ID</p>
            <p className="text-white/80 font-mono text-[11px]">{disputeCase.match_id}</p>
          </div>
          {(disputeCase.fair_play_review_flag || disputeCase.aml_review_flag || disputeCase.manual_settlement_review_flag || disputeCase.escalated) && (
            <div className="col-span-2 flex flex-wrap gap-1.5 pt-1">
              {disputeCase.escalated && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Escalated</span>}
              {disputeCase.fair_play_review_flag && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Fair Play Review</span>}
              {disputeCase.aml_review_flag && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">AML Review</span>}
              {disputeCase.manual_settlement_review_flag && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Manual Settlement Review</span>}
            </div>
          )}
        </div>
      </Card>

      <Card title="Financial Resolution">
        <FinancialResolutionPanel
          match={financials?.match}
          contestRecord={financials?.contestRecord}
          contestClearingNet={financials?.contestClearingNet || 0}
          fundsRecoverable={fundsRecoverable}
        />
      </Card>

      <Card title="Players">
        <div className="grid grid-cols-2 gap-3">
          <PlayerWalletCard label="Reporting User" player={financials?.reportingPlayer} />
          <PlayerWalletCard label="Reported User" player={financials?.reportedPlayer} />
        </div>
      </Card>

      <Card title="Match Replay">
        <MatchReplay moveLog={financials?.game?.move_log} finalFen={disputeCase.final_fen} />
      </Card>

      <Card title="Ledger Activity">
        <LedgerEntriesPanel entries={financials?.ledgerEntries} />
      </Card>

      <Card title="System Findings">
        <SystemFindingsPanel facts={facts} recommendedAction={recommendedAction} />
      </Card>

      <Card title="Related User History">
        <RelatedUserHistoryPanel reportingPlayer={financials?.reportingPlayer} reportedPlayer={financials?.reportedPlayer} />
      </Card>

      {priorReports.length > 0 && (
        <Card title={`Previous Reports Involving Either Player (${priorReports.length})`}>
          <div className="space-y-1.5">
            {priorReports.map((p) => (
              <Link key={p.id} to={`/admin/disputes/${p.id}`} className="flex justify-between text-xs hover:text-white">
                <span className="text-white/60">Case #{p.case_number} — {p.report_category?.replace("_", " ")}</span>
                <span className="text-white/30">{CASE_STATUS_LABELS[p.status]}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card title="Administrative Actions">
        <DisputeCaseActions disputeCase={disputeCase} onChanged={load} />
      </Card>

      <Card title="Case Timeline">
        <DisputeCaseTimeline notes={notes} />
      </Card>
    </div>
  );
}