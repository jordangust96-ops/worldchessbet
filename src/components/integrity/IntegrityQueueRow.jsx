import React from "react";
import { Link } from "react-router-dom";
import moment from "moment";
import { ChevronRight } from "lucide-react";
import { SeverityBadge, StatusBadge } from "@/components/integrity/IntegrityBadges";
import { FLAG_TYPE_LABELS } from "@/lib/integrityLabels";

export default function IntegrityQueueRow({ flag, userLabel, previousFlagCount }) {
  return (
    <Link
      to={`/admin/integrity/${flag.user_id}`}
      className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-colors"
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={flag.severity} />
          <StatusBadge status={flag.status} />
        </div>
        <p className="text-sm font-semibold text-white truncate">{userLabel}</p>
        <p className="text-xs text-white/50">{FLAG_TYPE_LABELS[flag.flag_type] || flag.flag_type}</p>
        <p className="text-[11px] text-white/30">
          {moment(flag.created_date).format("MMM D, YYYY h:mm A")} · {previousFlagCount} previous flag
          {previousFlagCount === 1 ? "" : "s"}
          {flag.match_id ? " · Linked contest" : ""}
        </p>
      </div>
      <ChevronRight size={16} className="text-white/20 shrink-0" />
    </Link>
  );
}