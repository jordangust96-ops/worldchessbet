import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import moment from "moment";
import { ArrowLeft, Loader2, Flag, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { CaseStatusBadge } from "@/components/disputes/DisputeCaseBadges";
import DisputeCaseNotesTimeline from "@/components/disputes/DisputeCaseNotesTimeline";
import { REPORT_CATEGORIES } from "@/lib/disputeCaseLabels";

function MyReportCard({ report }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const canReply = report.status !== "resolved" && report.status !== "closed";

  const toggleExpanded = async () => {
    if (!expanded && notes.length === 0) {
      setLoadingNotes(true);
      const rows = await base44.entities.DisputeCaseNote.filter({ case_id: report.id });
      setNotes([...rows].sort((a, b) => new Date(a.created_date) - new Date(b.created_date)));
      setLoadingNotes(false);
    }
    setExpanded((v) => !v);
  };

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await base44.functions.invoke("submitAdditionalInformation", { caseId: report.id, content: replyText });
      setReplyText("");
      const rows = await base44.entities.DisputeCaseNote.filter({ case_id: report.id });
      setNotes([...rows].sort((a, b) => new Date(a.created_date) - new Date(b.created_date)));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-2.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-white">
          Case #{report.case_number} · {REPORT_CATEGORIES[report.report_category]?.label || report.report_category}
        </p>
        <CaseStatusBadge status={report.status} />
      </div>
      <p className="text-[11px] text-white/30">{moment(report.created_date).format("MMM D, YYYY h:mm A")}</p>
      <p className="text-xs text-white/50 whitespace-pre-wrap">{report.report_description}</p>

      <button onClick={toggleExpanded} className="text-[11px] text-[#C9A84C] hover:underline">
        {expanded ? "Hide updates" : "View updates"}
      </button>

      {expanded && (
        <div className="pt-2 space-y-3">
          {loadingNotes ? (
            <Loader2 className="animate-spin text-white/30" size={16} />
          ) : (
            <DisputeCaseNotesTimeline notes={notes} />
          )}
          {canReply && (
            <div className="space-y-2 pt-1">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={2}
                placeholder="Add additional information..."
                className="w-full p-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none"
              />
              <Button
                size="sm"
                disabled={sending || !replyText.trim()}
                onClick={handleReply}
                className="h-8 rounded-lg text-xs gold-gradient text-black font-bold hover:opacity-90"
              >
                {sending ? <Loader2 size={12} className="animate-spin mr-1" /> : <Send size={12} className="mr-1" />}
                Send
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyReports() {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState([]);

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      const rows = await base44.entities.DisputeCase.filter({ reporting_user_id: me.id }, "-created_date");
      setReports(rows);
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

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-2xl mx-auto">
      <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <Flag size={18} className="text-[#C9A84C]" />
        </div>
        <h1 className="text-xl font-extrabold text-white">My Reports</h1>
      </div>
      <p className="text-xs text-white/40 mb-6">Reports you've submitted about contests, and their current status.</p>

      {reports.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-8 text-center">
          <p className="text-sm text-white/40">You haven't submitted any reports.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {reports.map((r) => (
            <MyReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}