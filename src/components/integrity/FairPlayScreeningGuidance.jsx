import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  Info,
  Plus,
  ShieldQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const TONES = {
  review: {
    border: "border-red-500/30",
    background: "bg-red-500/[0.07]",
    iconBackground: "bg-red-500/15",
    icon: "text-red-400",
    badge: "border-red-500/25 bg-red-500/10 text-red-300",
    button: "border-red-500/25 text-red-300 hover:bg-red-500/10",
  },
  monitor: {
    border: "border-amber-500/30",
    background: "bg-amber-500/[0.07]",
    iconBackground: "bg-amber-500/15",
    icon: "text-amber-400",
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    button: "border-amber-500/25 text-amber-300 hover:bg-amber-500/10",
  },
  cleared: {
    border: "border-emerald-500/25",
    background: "bg-emerald-500/[0.06]",
    iconBackground: "bg-emerald-500/15",
    icon: "text-emerald-400",
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    button: "border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/10",
  },
  info: {
    border: "border-sky-500/25",
    background: "bg-sky-500/[0.06]",
    iconBackground: "bg-sky-500/15",
    icon: "text-sky-400",
    badge: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    button: "border-sky-500/20 text-sky-300 hover:bg-sky-500/10",
  },
  unavailable: {
    border: "border-white/10",
    background: "bg-white/[0.025]",
    iconBackground: "bg-white/[0.06]",
    icon: "text-white/50",
    badge: "border-white/10 bg-white/[0.04] text-white/60",
    button: "border-white/10 text-white/60 hover:bg-white/[0.05]",
  },
};

function guidanceFor(analysis, side) {
  const status = analysis?.status || "queued";
  const band = analysis?.[side + "_risk_band"];
  const score = analysis?.[side + "_risk_score"];
  const analyzedMoves = analysis?.[side + "_eligible_moves"];
  const eligiblePositions = analysis?.eligible_move_count;
  const reasons = Array.isArray(analysis?.[side + "_screening_reasons"])
    ? analysis[side + "_screening_reasons"]
    : [];

  if (status === "queued" || status === "processing") {
    return {
      tone: "info",
      icon: Clock3,
      badge: "Analysis in progress",
      title: "Wait for the screening to finish",
      summary: "The analyzer has not produced a fair-play result yet.",
      instruction: "Do not draw a conclusion from this record until processing completes.",
      reasons: [],
      analyzedMoves,
      eligiblePositions,
    };
  }

  if (status === "failed" || status === "awaiting_analyzer") {
    return {
      tone: "unavailable",
      icon: ShieldQuestion,
      badge: "Screening incomplete",
      title: "No automated result is available",
      summary: "The screening did not complete, so this record cannot support a fair-play conclusion.",
      instruction: "Retry the analysis. If a report or dispute is active, review the game and other evidence manually.",
      reasons: [],
      analyzedMoves,
      eligiblePositions,
    };
  }

  if (band === "review") {
    return {
      tone: "review",
      icon: AlertTriangle,
      badge: "Manual review recommended",
      title: "Elevated fair-play signals detected",
      summary: typeof score === "number"
        ? `The automated risk score is ${score}. This is an indicator for investigation, not a finding of cheating.`
        : "The analyzer identified signals that warrant a closer look. This is not a finding of cheating.",
      instruction: "Review the listed reasons, technical metrics, related contests, player reports, and account history. Confirm corroborating evidence before taking any enforcement or financial action.",
      reasons,
      analyzedMoves,
      eligiblePositions,
    };
  }

  if (band === "monitor") {
    return {
      tone: "monitor",
      icon: Eye,
      badge: "Monitor",
      title: "Some signals warrant continued observation",
      summary: "The result is not strong enough to recommend an enforcement review, but it should be compared with other games and evidence.",
      instruction: "Review related contests and reports. Create an integrity flag only if the pattern repeats or other evidence supports escalation.",
      reasons,
      analyzedMoves,
      eligiblePositions,
    };
  }

  if (band === "cleared") {
    return {
      tone: "cleared",
      icon: CheckCircle2,
      badge: "No automated concern",
      title: "No fair-play action is recommended",
      summary: "This screening did not identify automated signals that require review.",
      instruction: "No action is needed from this result. Continue normal monitoring and consider any independent reports or evidence separately.",
      reasons,
      analyzedMoves,
      eligiblePositions,
    };
  }

  if (band === "insufficient_data") {
    return {
      tone: "info",
      icon: Info,
      badge: "Insufficient data",
      title: "No fair-play determination can be made",
      summary: typeof analyzedMoves === "number"
        ? `Only ${analyzedMoves} move${analyzedMoves === 1 ? "" : "s"} for this player met the analysis criteria.`
        : "The game did not provide enough eligible positions for a reliable automated assessment.",
      instruction: "Do not clear or penalize the player based on this result. No action is required unless a report, dispute, repeated pattern, or other evidence warrants manual review.",
      reasons: [],
      analyzedMoves,
      eligiblePositions,
    };
  }

  return {
    tone: "unavailable",
    icon: ShieldQuestion,
    badge: "Result unavailable",
    title: "No screening guidance is available",
    summary: "This record does not contain a recognized fair-play disposition.",
    instruction: "Review the technical record and retry the analysis if appropriate.",
    reasons,
    analyzedMoves,
    eligiblePositions,
  };
}

export default function FairPlayScreeningGuidance({
  analysis,
  reviewedPlayerColor,
  hasOpenFlag,
  onCreateFlag,
  onReviewFlags,
  onReviewContests,
}) {
  if (!analysis) return null;

  const side = reviewedPlayerColor === "black" ? "black" : "white";
  const guidance = guidanceFor(analysis, side);
  const tone = TONES[guidance.tone];
  const Icon = guidance.icon;
  const showReviewActions = guidance.tone === "review" || guidance.tone === "monitor";

  return (
    <div className={`rounded-2xl border ${tone.border} ${tone.background} p-4 mb-3`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl ${tone.iconBackground} flex items-center justify-center shrink-0`}>
          <Icon size={18} className={tone.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone.badge}`}>
              {guidance.badge}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-white/30">
              Latest screening · {side}
            </span>
          </div>

          <h3 className="mt-3 text-sm font-bold text-white">{guidance.title}</h3>
          <p className="mt-1 text-xs leading-5 text-white/60">{guidance.summary}</p>

          <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/15 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Recommended admin action</p>
            <p className="mt-1 text-xs leading-5 text-white/70">{guidance.instruction}</p>
          </div>

          {(typeof guidance.analyzedMoves === "number" || typeof guidance.eligiblePositions === "number") && (
            <p className="mt-2 text-[11px] text-white/35">
              Evidence coverage: {typeof guidance.analyzedMoves === "number" ? guidance.analyzedMoves : "—"} player moves analyzed
              {typeof guidance.eligiblePositions === "number" ? ` · ${guidance.eligiblePositions} eligible positions in the game` : ""}
            </p>
          )}

          {guidance.reasons.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Analyzer reasons</p>
              <ul className="mt-1.5 space-y-1">
                {guidance.reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2 text-xs leading-5 text-white/60">
                    <span className={`mt-2 h-1 w-1 rounded-full shrink-0 ${tone.iconBackground}`} />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showReviewActions && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onReviewContests}
                className={`h-8 rounded-lg bg-transparent text-xs ${tone.button}`}
              >
                <Eye size={12} className="mr-1.5" /> Review related contests
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onReviewFlags}
                className={`h-8 rounded-lg bg-transparent text-xs ${tone.button}`}
              >
                <ShieldQuestion size={12} className="mr-1.5" /> Review risk flags
              </Button>
              {!hasOpenFlag && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCreateFlag}
                  className={`h-8 rounded-lg bg-transparent text-xs ${tone.button}`}
                >
                  <Plus size={12} className="mr-1.5" /> Create integrity flag
                </Button>
              )}
            </div>
          )}

          <p className="mt-3 text-[10px] leading-4 text-white/30">
            Decision support only. Automated screening never establishes misconduct or authorizes enforcement by itself.
          </p>
        </div>
      </div>
    </div>
  );
}
