import React from "react";
import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { CASE_STATUS_LABELS } from "@/lib/reportCategories";

export default function CaseReviewStatus({ disputeCase, adminId }) {
  const isTerminal = disputeCase.status === "resolved" || disputeCase.status === "closed";
  const isWaiting = disputeCase.status === "awaiting_information";
  const isReviewing = disputeCase.status === "under_review";
  const assignedLabel = !disputeCase.assigned_admin_id
    ? "Unassigned"
    : disputeCase.assigned_admin_id === adminId
      ? "Assigned to you"
      : "Assigned to another administrator";

  const status = isTerminal
    ? {
        icon: CheckCircle2,
        title: "Review complete",
        text: "The formal resolution is preserved below. Only follow-up internal notes may be added.",
        className: "border-emerald-500/25 bg-emerald-500/[0.07]",
        iconClass: "text-emerald-400",
      }
    : isWaiting
      ? {
          icon: Clock3,
          title: "Waiting for player information",
          text: "The reporting player has a visible information request. Resume review after their response is received.",
          className: "border-amber-400/25 bg-amber-400/[0.07]",
          iconClass: "text-amber-300",
        }
      : isReviewing
        ? {
            icon: ShieldCheck,
            title: "Review in progress",
            text: "Review the report, system evidence, financial snapshot, and related history before concluding the case.",
            className: "border-blue-400/20 bg-blue-400/[0.06]",
            iconClass: "text-blue-300",
          }
        : {
            icon: AlertTriangle,
            title: "Action required: review not started",
            text: "Assign the case and begin review. No report should be resolved from the allegation alone.",
            className: "border-red-500/25 bg-red-500/[0.07]",
            iconClass: "text-red-300",
          };

  const StatusIcon = status.icon;
  const chips = [
    disputeCase.escalated && "High-priority escalation",
    disputeCase.fair_play_review_flag && "Fair Play review",
    disputeCase.aml_review_flag && "AML / compliance review",
    disputeCase.manual_settlement_review_flag && "Settlement review",
    disputeCase.hold_status &&
      !["none", "released"].includes(disputeCase.hold_status) &&
      "Active financial hold",
  ].filter(Boolean);

  return (
    <div className={`mb-4 rounded-2xl border p-4 ${status.className}`}>
      <div className="flex items-start gap-3">
        <StatusIcon size={19} className={`mt-0.5 shrink-0 ${status.iconClass}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-white">{status.title}</p>
            <span className="rounded-full bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
              {CASE_STATUS_LABELS[disputeCase.status] || disputeCase.status}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-white/50">{status.text}</p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            {assignedLabel}
          </p>
          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/55"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {!isTerminal && (
        <a
          href="#case-actions"
          className="mt-3 inline-flex text-xs font-semibold text-[#E2C66E] hover:underline"
        >
          Review available actions
        </a>
      )}
    </div>
  );
}
