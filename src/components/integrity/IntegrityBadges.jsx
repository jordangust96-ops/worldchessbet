import React from "react";
import { SEVERITY_STYLES, STATUS_STYLES, STATUS_LABELS } from "@/lib/integrityLabels";

export function SeverityBadge({ severity }) {
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.low}`}
    >
      {severity}
    </span>
  );
}

export function StatusBadge({ status }) {
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] || STATUS_STYLES.open}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}