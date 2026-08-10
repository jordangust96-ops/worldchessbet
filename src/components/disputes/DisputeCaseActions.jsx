import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Flag,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

const SPECIALIST_REVIEWS = [
  {
    key: "fair_play_review_flag",
    action: "flag_fair_play_review",
    label: "Fair Play Review",
    description: "Adds an internal fair-play signal for engine and match-evidence review. No enforcement action is taken.",
  },
  {
    key: "aml_review_flag",
    action: "flag_aml_review",
    label: "AML / Compliance Review",
    description: "Marks the case for financial-compliance review. It does not place a hold or change an account.",
  },
  {
    key: "manual_settlement_review_flag",
    action: "flag_manual_settlement_review",
    label: "Settlement Review",
    description: "Requests manual review of settlement records. It does not reverse or move funds.",
  },
];

function ActionError({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-3 text-xs text-red-300">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// This panel separates case workflow, review signals, communication, notes,
// and formal resolution. Every operation still goes through manageDisputeCase,
// which enforces administrator access and appends the audit trail.
export default function DisputeCaseActions({
  disputeCase,
  onChanged,
  recommendedAction,
  recommendationRationale,
}) {
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [escalationReason, setEscalationReason] = useState("");
  const [resolution, setResolution] = useState("");
  const [openForm, setOpenForm] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState("");

  const isTerminal = disputeCase.status === "resolved" || disputeCase.status === "closed";
  const isAssignedToMe = !!user?.id && disputeCase.assigned_admin_id === user.id;
  const isAssignedElsewhere = !!disputeCase.assigned_admin_id && !isAssignedToMe;
  const isReviewing = disputeCase.status === "under_review";
  const isWaiting = disputeCase.status === "awaiting_information";
  const hasActiveHold =
    disputeCase.hold_status && !["none", "released"].includes(disputeCase.hold_status);

  const invoke = (action, payload = {}) =>
    base44.functions.invoke("manageDisputeCase", {
      caseId: disputeCase.id,
      action,
      payload,
    });

  const finishAction = async () => {
    setNote("");
    setRequestMessage("");
    setEscalationReason("");
    setOpenForm(null);
    await onChanged?.();
  };

  const runAction = async (busyKey, action, payload = {}) => {
    setBusyAction(busyKey);
    setError("");
    try {
      await invoke(action, payload);
      await finishAction();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "The action could not be completed.");
    } finally {
      setBusyAction(null);
    }
  };

  const beginReview = async () => {
    if (
      isAssignedElsewhere &&
      !window.confirm("This case is assigned to another administrator. Reassign it to you and continue?")
    ) {
      return;
    }

    setBusyAction("begin_review");
    setError("");
    try {
      if (!isAssignedToMe) await invoke("assign_to_me");
      if (!isReviewing) await invoke("change_status", { status: "under_review" });
      await finishAction();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "The review could not be started.");
    } finally {
      setBusyAction(null);
    }
  };

  const reviewLabel = isWaiting
    ? isAssignedElsewhere
      ? "Reassign & Resume Review"
      : "Resume Review"
    : isReviewing
      ? isAssignedElsewhere
        ? "Reassign to Me"
        : "Review in Progress"
      : isAssignedElsewhere
        ? "Reassign & Begin Review"
        : "Assign & Begin Review";

  if (isTerminal) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-emerald-300">Formal review complete</p>
            <p className="mt-0.5 text-xs leading-5 text-white/45">
              This case is read-only except for additional internal notes. Its resolution and audit history remain preserved.
            </p>
          </div>
        </div>
        <ActionError message={error} />
        <div className="space-y-2">
          <label className="text-xs font-semibold text-white/60">Add post-resolution internal note</label>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Document follow-up information without changing the resolution..."
            className="min-h-[76px] border-white/10 bg-white/[0.03] text-xs text-white"
          />
          <Button
            size="sm"
            disabled={!!busyAction || !note.trim()}
            onClick={() => runAction("add_note", "add_note", { content: note })}
            className="gold-gradient font-semibold text-black hover:opacity-90"
          >
            {busyAction === "add_note" && <Loader2 size={13} className="mr-1.5 animate-spin" />}
            Save Internal Note
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(recommendedAction || recommendationRationale) && (
        <div className="rounded-xl border border-[#C9A84C]/25 bg-[#C9A84C]/[0.08] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#C9A84C]/70">
            Suggested next step
          </p>
          {recommendedAction && (
            <p className="mt-1 text-sm font-semibold leading-5 text-[#E2C66E]">{recommendedAction}</p>
          )}
          {recommendationRationale && (
            <p className="mt-1 text-xs leading-5 text-white/50">{recommendationRationale}</p>
          )}
          <p className="mt-2 text-[10px] leading-4 text-white/30">
            Guidance is non-binding. Confirm the report, evidence, and financial record before acting.
          </p>
        </div>
      )}

      <ActionError message={error} />

      <section className="space-y-2.5">
        <div>
          <p className="text-xs font-semibold text-white/75">1. Case workflow</p>
          <p className="mt-0.5 text-[11px] leading-4 text-white/35">
            Claim the case and record that active review has begun. This does not affect the contest, funds, or either account.
          </p>
        </div>
        <Button
          size="sm"
          disabled={!!busyAction || (isReviewing && isAssignedToMe)}
          onClick={beginReview}
          className="gold-gradient text-black font-semibold hover:opacity-90"
        >
          {busyAction === "begin_review" ? (
            <Loader2 size={14} className="mr-1.5 animate-spin" />
          ) : (
            <UserCheck size={14} className="mr-1.5" />
          )}
          {reviewLabel}
        </Button>
        <p className="text-[10px] text-white/30">
          {isAssignedToMe
            ? "Assigned to you."
            : isAssignedElsewhere
              ? "Currently assigned to another administrator."
              : "Currently unassigned."}
        </p>
      </section>

      <section className="space-y-2.5 border-t border-white/[0.06] pt-4">
        <div>
          <p className="text-xs font-semibold text-white/75">2. Investigation actions</p>
          <p className="mt-0.5 text-[11px] leading-4 text-white/35">
            Use only the action that matches what is needed next. Each action is timestamped in the case timeline.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setOpenForm(openForm === "request" ? null : "request")}
            disabled={!!busyAction}
            className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-left transition-colors hover:bg-amber-500/[0.08] disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <MessageSquareText size={15} className="text-amber-300" />
              <span className="text-xs font-semibold text-amber-200">Request Player Information</span>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-white/40">
              Sends a user-visible message to the reporting player and moves the case to Waiting for Information.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setOpenForm(openForm === "escalate" ? null : "escalate")}
            disabled={!!busyAction || disputeCase.escalated}
            className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3 text-left transition-colors hover:bg-red-500/[0.08] disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-300" />
              <span className="text-xs font-semibold text-red-200">
                {disputeCase.escalated ? "Already Escalated" : "Escalate Priority"}
              </span>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-white/40">
              Marks the case high priority and emails administrators. It does not enforce a penalty or move funds.
            </p>
          </button>
        </div>

        {openForm === "request" && (
          <div className="space-y-2 rounded-xl border border-amber-500/15 bg-black/20 p-3">
            <label className="text-xs font-semibold text-white/65">Message to reporting player</label>
            <Textarea
              value={requestMessage}
              onChange={(event) => setRequestMessage(event.target.value)}
              placeholder="Describe exactly what information or evidence is needed..."
              className="min-h-[88px] border-white/10 bg-white/[0.03] text-xs text-white"
            />
            <p className="text-[10px] leading-4 text-amber-200/55">
              This text becomes visible in the player’s case history.
            </p>
            <Button
              size="sm"
              disabled={!!busyAction || !requestMessage.trim()}
              onClick={() =>
                runAction("request_information", "request_information", { content: requestMessage })
              }
              className="bg-amber-400 text-black font-semibold hover:bg-amber-300"
            >
              {busyAction === "request_information" && (
                <Loader2 size={13} className="mr-1.5 animate-spin" />
              )}
              Send Request
            </Button>
          </div>
        )}

        {openForm === "escalate" && !disputeCase.escalated && (
          <div className="space-y-2 rounded-xl border border-red-500/15 bg-black/20 p-3">
            <label className="text-xs font-semibold text-white/65">Internal escalation reason</label>
            <Textarea
              value={escalationReason}
              onChange={(event) => setEscalationReason(event.target.value)}
              placeholder="Explain why priority review or another administrator’s attention is required..."
              className="min-h-[88px] border-white/10 bg-white/[0.03] text-xs text-white"
            />
            <Button
              size="sm"
              disabled={!!busyAction || !escalationReason.trim()}
              onClick={() => runAction("escalate", "escalate", { content: escalationReason })}
              className="bg-red-500/90 text-white font-semibold hover:bg-red-500"
            >
              {busyAction === "escalate" && <Loader2 size={13} className="mr-1.5 animate-spin" />}
              Confirm Escalation
            </Button>
          </div>
        )}
      </section>

      <details className="group border-t border-white/[0.06] pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-white/75">
              <Flag size={14} className="text-white/45" />
              Add specialist review
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-white/35">
              Optional internal signals for fair play, compliance, or settlement specialists.
            </p>
          </div>
          <ChevronDown size={15} className="text-white/30 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-2">
          {SPECIALIST_REVIEWS.map((review) => {
            const applied = !!disputeCase[review.key];
            return (
              <div
                key={review.action}
                className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/70">{review.label}</p>
                  <p className="mt-0.5 text-[10px] leading-4 text-white/35">{review.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busyAction || applied}
                  onClick={() => runAction(review.action, review.action)}
                  className="shrink-0 border-white/10 bg-transparent text-xs text-white/60"
                >
                  {busyAction === review.action && (
                    <Loader2 size={12} className="mr-1.5 animate-spin" />
                  )}
                  {applied ? "Added" : "Add Review"}
                </Button>
              </div>
            );
          })}
        </div>
      </details>

      <details className="group border-t border-white/[0.06] pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-white/75">
              <MessageSquareText size={14} className="text-white/45" />
              Add internal case note
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-white/35">
              Records investigation context without changing status or notifying players.
            </p>
          </div>
          <ChevronDown size={15} className="text-white/30 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-2">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Document evidence reviewed, reasoning, or follow-up..."
            className="min-h-[82px] border-white/10 bg-white/[0.03] text-xs text-white"
          />
          <Button
            size="sm"
            disabled={!!busyAction || !note.trim()}
            onClick={() => runAction("add_note", "add_note", { content: note })}
            className="gold-gradient font-semibold text-black hover:opacity-90"
          >
            {busyAction === "add_note" && <Loader2 size={13} className="mr-1.5 animate-spin" />}
            Save Internal Note
          </Button>
        </div>
      </details>

      <section className="space-y-2.5 border-t border-white/[0.06] pt-4">
        <div className="flex items-start gap-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          <div>
            <p className="text-xs font-semibold text-white/80">3. Conclude without enforcement</p>
            <p className="mt-0.5 text-[11px] leading-4 text-white/40">
              Use only when the evidence supports no violation. This creates the formal resolution, closes the case, notifies affected players, preserves the contest result, and releases any case-level financial hold.
              An account suspension is not independently restored by this action.
            </p>
          </div>
        </div>
        {hasActiveHold && (
          <p className="rounded-lg bg-amber-500/[0.08] px-3 py-2 text-[10px] leading-4 text-amber-200/70">
            Active hold detected: resolving as no violation will release this case’s hold.
          </p>
        )}
        <Textarea
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          placeholder="Internal rationale supporting the no-violation determination..."
          className="min-h-[92px] border-white/10 bg-white/[0.03] text-xs text-white"
        />
        <Button
          size="sm"
          disabled={!!busyAction || !resolution.trim()}
          onClick={() => {
            const holdText = hasActiveHold ? " The active case hold will be released." : "";
            if (
              window.confirm(
                `Resolve this case as no violation? The case will close, affected players will be notified, and the contest result will stand.${holdText}`
              )
            ) {
              runAction("resolve_case", "resolve_case", {
                resolutionType: "no_violation",
                internalRationale: resolution,
                userFacingSummary: "Review completed. No violation was found.",
              });
            }
          }}
          className="bg-emerald-500/90 text-black font-semibold hover:opacity-90"
        >
          {busyAction === "resolve_case" && <Loader2 size={13} className="mr-1.5 animate-spin" />}
          Resolve as No Violation
        </Button>
        <p className="text-[10px] leading-4 text-white/25">
          Contest reversals, account restrictions, and financial remedies are intentionally not exposed as quick actions here because they require a separate, evidence-specific administrative procedure.
        </p>
      </section>
    </div>
  );
}
