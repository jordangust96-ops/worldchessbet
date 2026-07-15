import React from "react";
import { CASE_STATUS_STYLES, CASE_STATUS_LABELS, CASE_PRIORITY_STYLES } from "@/lib/disputeCaseLabels";

export function CaseStatusBadge({ status }) {
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${CASE_STATUS_STYLES[status] || CASE_STATUS_STYLES.open}`}
    >
      {CASE_STATUS_LABELS[status] || status}
    </span>
  );
}

export function CasePriorityBadge({ priority }) {
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${CASE_PRIORITY_STYLES[priority] || CASE_PRIORITY_STYLES.medium}`}
    >
      {priority}
    </span>
  );
}