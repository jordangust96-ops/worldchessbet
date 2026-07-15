import React, { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import moment from "moment";
import { ArrowLeft, Loader2, Gavel } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { CaseStatusBadge, CasePriorityBadge } from "@/components/disputes/DisputeCaseBadges";
import DisputeCaseActionsPanel from "@/components/disputes/DisputeCaseActionsPanel";
import DisputeCaseNotesTimeline from "@/components/disputes/DisputeCaseNotesTimeline";
import DisputeCaseRow from "@/components/disputes/DisputeCaseRow";
import { REPORT_CATEGORIES } from "@/lib/disputeCaseLabels";

export default function AdminDisputeCaseDetail() {
  const { caseId } = useParams();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [disputeCase, setDisputeCase] = useState(null);
  const [notes, setNotes] = useState([]);
  const [userLabels, setUserLabels] = useState({});
  const [previousCases, setPreviousCases] = useState([]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const load = async () => {
    const me = await base44.auth.me();
    if (me?.role !== "admin") {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);

    const c = await base44.entities.DisputeCase.get(caseId).catch(() => null);
    setDisputeCase(c);
    if (!c) {
      setLoading(false);
      return;
    }

    const [caseNotes, reporter, reported] = await Promise.all([
      base44.entities.DisputeCaseNote.filter({ case_id: caseId }, "-created_date"),
      c.reporting_user_id ? base44.entities.User.get(c.reporting_user_id).catch(() => null) : null,
      c.reported_user_id ? base44.entities.User.get(c.reported_user_id).catch(() => null) : null,
    ]);
    setNotes([...caseNotes].sort((a, b) => new Date(a.created_date) - new Date(b.created_date)));
    setUserLabels({
      [c.reporting_user_id]: reporter?.full_name || reporter?.email || c.reporting_user_id,
      [c.reported_user_id]: reported?.full_name || reported?.email || c.reported_user_id,
    });

    // Previous reports involving either player.
    const involvedIds = [c.reporting_user_id, c.reported_user_id].filter(Boolean);
    if (involvedIds.length > 0) {
      const all = await base44.entities.DisputeCase.list("-created_date", 500);
      setPreviousCases(
        all.filter(
          (other) =>
            other.id !== c.id &&
            (involvedIds.includes(other.reporting_user_id) || involvedIds.includes(other.reported_user_id))
        )
      );
    }

    setLoading(false);
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

  if (!disputeCase) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0A] px-5 text-center">
        <p className="text-white font-semibold mb-2">Case Not Found</p>
        <Link to="/admin/disputes" className="text-xs text-[#C9A84C] hover:underline">
          Back to Dispute Case Queue
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-2xl mx-auto">
      <Link to="/admin/disputes" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Dispute Case Queue
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
            <Gavel size={18} className="text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-white">Case #{disputeCase.case_number}</h1>
            <p className="text-xs text-white/40">
              {REPORT_CATEGORIES[disputeCase.report_category]?.label || disputeCase.report_category}
              {disputeCase.report_subcategory ? ` · ${disputeCase.report_subcategory}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CasePriorityBadge priority={disputeCase.priority} />
          <CaseStatusBadge status={disputeCase.status} />
        </div>
      </div>

      <p className="text-xs text-white/30 mt-2">{moment(disputeCase.created_date).format("MMM D, YYYY h:mm A")}</p>

      <div className="mt-5 rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-2">
        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Report Description</p>
        <p className="text-sm text-white/80 whitespace-pre-wrap">{disputeCase.report_description}</p>
      </div>

      <div className="mt-4 rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-white/40">Reporting User</span>
          <span className="text-white/80 font-semibold">{userLabels[disputeCase.reporting_user_id]}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/40">Reported User</span>
          <span className="text-white/80 font-semibold">{userLabels[disputeCase.reported_user_id] || "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/40">Time Control</span>
          <span className="text-white/80 font-semibold">{disputeCase.display_name || "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/40">Entry Amount</span>
          <span className="text-white/80 font-semibold">${(disputeCase.entry_amount || 0).toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/40">Outcome</span>
          <span className="text-white/80 font-semibold">{disputeCase.outcome_type || "Not yet decided"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/40">Match ID</span>
          <span className="text-white/80 font-mono text-[11px]">{disputeCase.match_id}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/40">Ledger References</span>
          <span className="text-white/80 font-semibold">{(disputeCase.ledger_entry_ids || []).length}</span>
        </div>
        {disputeCase.final_fen && (
          <div>
            <span className="text-white/40 block mb-1">Final Position (FEN)</span>
            <span className="text-white/60 font-mono text-[10px] break-all">{disputeCase.final_fen}</span>
          </div>
        )}
        {disputeCase.pgn && (
          <div>
            <span className="text-white/40 block mb-1">Move History (PGN)</span>
            <span className="text-white/60 font-mono text-[10px] break-all whitespace-pre-wrap">{disputeCase.pgn}</span>
          </div>
        )}
      </div>

      {(disputeCase.fair_play_review_flag || disputeCase.aml_review_flag || disputeCase.manual_settlement_review_flag) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {disputeCase.fair_play_review_flag && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20">
              Fair Play Review
            </span>
          )}
          {disputeCase.aml_review_flag && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20">
              AML Review
            </span>
          )}
          {disputeCase.manual_settlement_review_flag && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20">
              Manual Settlement Review
            </span>
          )}
        </div>
      )}

      {disputeCase.resolution && (
        <div className="mt-4 rounded-2xl bg-green-500/5 border border-green-500/20 p-4">
          <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-1">Resolution</p>
          <p className="text-sm text-white/80 whitespace-pre-wrap">{disputeCase.resolution}</p>
        </div>
      )}

      <div className="mt-6">
        <DisputeCaseActionsPanel disputeCase={disputeCase} onChanged={load} />
      </div>

      <h2 className="text-sm font-bold text-white/80 mt-7 mb-3">Case History</h2>
      <DisputeCaseNotesTimeline notes={notes} />

      <h2 className="text-sm font-bold text-white/80 mt-7 mb-3">Previous Reports Involving Either Player</h2>
      {previousCases.length === 0 ? (
        <p className="text-xs text-white/30">None found.</p>
      ) : (
        <div className="space-y-2.5">
          {previousCases.map((c) => (
            <DisputeCaseRow
              key={c.id}
              disputeCase={c}
              reporterLabel={userLabels[c.reporting_user_id] || c.reporting_user_id}
              reportedLabel={userLabels[c.reported_user_id] || c.reported_user_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}