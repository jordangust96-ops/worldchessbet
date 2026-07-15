import React from "react";
import { Link } from "react-router-dom";
import { CASE_STATUS_LABELS } from "@/lib/reportCategories";

const STATUS_STYLES = {
  open: "bg-white/10 text-white/60",
  under_review: "bg-blue-500/10 text-blue-400",
  awaiting_information: "bg-amber-500/10 text-amber-400",
  resolved: "bg-emerald-500/10 text-emerald-400",
  closed: "bg-white/5 text-white/40",
};

const PRIORITY_STYLES = {
  low: "text-white/30",
  medium: "text-white/50",
  high: "text-red-400",
};

export default function DisputeCaseRow({ disputeCase }) {
  return (
    <Link
      to={`/admin/disputes/${disputeCase.id}`}
      className="grid grid-cols-6 gap-3 items-center rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 px-4 py-3 text-xs transition-colors"
    >
      <span className="font-bold text-white">#{disputeCase.case_number}</span>
      <span className={`font-semibold uppercase ${PRIORITY_STYLES[disputeCase.priority]}`}>{disputeCase.priority}</span>
      <span className="text-white/60 truncate">
        {disputeCase.report_category?.replace("_", " ")}
        {disputeCase.report_subcategory ? ` · ${disputeCase.report_subcategory}` : ""}
      </span>
      <span className="text-white/60 truncate">
        {disputeCase.reporting_user_username} vs {disputeCase.reported_user_username || "—"}
      </span>
      <span className="text-white/40">{new Date(disputeCase.created_date).toLocaleDateString()}</span>
      <span className={`justify-self-start text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full ${STATUS_STYLES[disputeCase.status]}`}>
        {CASE_STATUS_LABELS[disputeCase.status]}
      </span>
    </Link>
  );
}