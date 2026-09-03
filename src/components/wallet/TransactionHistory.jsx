import React, { useState } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Minus,
  ChevronDown,
  Copy,
  Check,
} from "lucide-react";
import moment from "moment";
import TransactionPagination from "@/components/wallet/TransactionPagination";
import ReportContestButton from "@/components/disputes/ReportContestButton";

const typeConfig = {
  deposit: { icon: ArrowDownLeft, color: "text-green-400", bg: "bg-green-500/10", label: "Fund Account" },
  withdrawal: { icon: ArrowUpRight, color: "text-red-400", bg: "bg-red-500/10", label: "Withdraw Funds" },
  wager_lock: { icon: Minus, color: "text-orange-400", bg: "bg-orange-500/10", label: "Contest Entry Reserved" },
  wager_refund: { icon: Plus, color: "text-blue-400", bg: "bg-blue-500/10", label: "Contest Entry Refund" },
  payout: { icon: ArrowDownLeft, color: "text-[#C9A84C]", bg: "bg-[#C9A84C]/10", label: "Contest Winnings" },
  wager_forfeit: { icon: Minus, color: "text-red-400", bg: "bg-red-500/10", label: "Contest Entry Forfeited" },
  service_fee_charge: { icon: Minus, color: "text-orange-400", bg: "bg-orange-500/10", label: "Platform Service Fee" },
  service_fee_refund: { icon: Plus, color: "text-blue-400", bg: "bg-blue-500/10", label: "Platform Service Fee Refund" },
  withdrawal_fee: { icon: Minus, color: "text-amber-400", bg: "bg-amber-500/10", label: "Small Withdrawal Fee" },
};

const SMALL_WITHDRAWAL_THRESHOLD = 10;

const statusConfig = {
  completed: { label: "Completed", className: "text-green-400 bg-green-500/10 border-green-500/20" },
  pending: { label: "Pending", className: "text-[#C9A84C] bg-[#C9A84C]/10 border-[#C9A84C]/20" },
  failed: { label: "Not applied", className: "text-white/45 bg-white/5 border-white/10" },
  review_required: { label: "Review required", className: "text-orange-300 bg-orange-500/10 border-orange-500/20" },
};

const incomingTypes = ["deposit", "payout", "wager_refund", "service_fee_refund"];
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

function shortReference(id) {
  if (!id) return null;
  return id.slice(-8).toUpperCase();
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function titleCase(value) {
  if (!value) return null;
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function serverTimestampMs(value) {
  if (!value) return NaN;
  const text = String(value);
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
  return new Date(normalized).getTime();
}

function isSuppressedDuplicate(tx) {
  if (tx.status !== "failed") return false;
  const details = String(tx.description || "").toLowerCase();
  return (
    details.includes("duplicate") ||
    details.includes("another settlement") ||
    details.includes("already completed") ||
    details.includes("already processed")
  );
}

function getTransactionExplanation(tx, match) {
  const amount = `$${formatMoney(tx.amount)}`;
  const entry = match?.wager_amount != null ? `$${formatMoney(match.wager_amount)}` : null;

  if (isSuppressedDuplicate(tx)) {
    return {
      heading: "No balance change",
      text: "This was a duplicate processing attempt. It did not change your balance and can be ignored because the contest was completed in another transaction.",
    };
  }
  if (tx.status === "failed") {
    return {
      heading: "Not applied",
      text: "This transaction did not change your balance. Check the other transactions for this contest; if the expected result is missing, report the contest within 24 hours.",
    };
  }
  if (tx.status === "review_required") {
    return {
      heading: "Review required",
      text: "Processing paused for review, so the referenced amount is not shown as completed. ChessBet will review the contest and its ledger records.",
    };
  }
  if (tx.status === "pending") {
    return {
      heading: "Still processing",
      text: "This transaction has not finished processing. Your balance and transaction history will update when it completes.",
    };
  }

  const explanations = {
    deposit: `This transaction added ${amount} to your available balance.`,
    withdrawal: `This transaction removed ${amount} from your ChessBet balance for withdrawal.`,
    wager_lock: `Your ${amount} contest entry moved from available funds to reserved funds when the contest began.`,
    wager_refund: `Your ${amount} contest entry was returned to your available balance.`,
    wager_forfeit: `You lost this contest, so your ${amount} reserved contest entry was forfeited to your opponent and is no longer part of your balance.`,
    payout: entry
      ? `You won this contest and ${amount} was added to your available balance. The prize is funded by both players’ ${entry} contest entries; platform service fees are separate.`
      : `You won this contest and ${amount} was added to your available balance. Platform service fees are separate from the prize.`,
    service_fee_charge: `The separate ${amount} platform service fee was reserved when the contest began. It is not deducted from the winner’s prize.`,
    service_fee_refund: `The ${amount} platform service fee was returned to your available balance.`,
  };

  return {
    heading: "What this means",
    text: explanations[tx.type] || tx.description || "This completed transaction has been reflected in your balance.",
  };
}

function getMatchResult(match, userId) {
  if (!match) return null;
  if (match.status === "cancelled" || match.result === "cancelled") return "Cancelled";
  if (match.status === "disputed") return "Under review";
  if (match.status !== "completed") return titleCase(match.status);
  if (match.result === "draw" || !match.winner_id) return "Draw";
  return match.winner_id === userId ? "Won" : "Lost";
}

function DetailItem({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/25">{label}</p>
      <p className="mt-1 text-xs font-medium text-white/70">{value}</p>
    </div>
  );
}

export default function TransactionHistory({
  transactions,
  matchDetailsById = {},
  userId,
  page,
  pageSize,
  totalCount,
  onPageChange,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  const copyReference = async (transactionId) => {
    try {
      await navigator.clipboard.writeText(transactionId);
      setCopiedId(transactionId);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setCopiedId(null);
    }
  };

  if (totalCount === 0) {
    return (
      <div className="text-center py-10 rounded-2xl bg-white/[0.02] border border-white/5">
        <p className="text-white/30 text-sm">No transactions yet</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-white/30 mb-3">
        Showing {rangeStart}–{rangeEnd} of {totalCount} transactions
      </p>
      <div className="space-y-2">
        {transactions.map((tx) => {
          const config = typeConfig[tx.type] || typeConfig.deposit;
          const Icon = config.icon;
          const isIncoming = incomingTypes.includes(tx.type);
          const isExpanded = expandedId === tx.id;
          const context = tx.match_id ? matchDetailsById[tx.match_id] : null;
          const match = context?.match;
          const matchReference = shortReference(tx.match_id);
          const transactionReference = shortReference(tx.id);
          const opponentName = context?.opponentName;
          const timeControl = match?.display_name || titleCase(match?.time_control);
          const result = getMatchResult(match, userId);
          const status = statusConfig[tx.status] || statusConfig.completed;
          const isFailed = tx.status === "failed";
          const needsReview = tx.status === "review_required";
          const explanation = getTransactionExplanation(tx, match);
          const transactionCreatedMs = serverTimestampMs(tx.created_date);
          const transactionAgeMs = Date.now() - transactionCreatedMs;
          const hasReportableContest = Boolean(tx.match_id && match);
          const canReportContest =
            hasReportableContest &&
            Number.isFinite(transactionAgeMs) &&
            transactionAgeMs >= -5 * 60 * 1000 &&
            transactionAgeMs <= REPORT_WINDOW_MS;
          const reportDeadline = Number.isFinite(transactionCreatedMs)
            ? transactionCreatedMs + REPORT_WINDOW_MS
            : null;
          const amountLabel = isFailed
            ? `Not applied · $${formatMoney(tx.amount)}`
            : needsReview
              ? `Review · $${formatMoney(tx.amount)}`
              : `${isIncoming ? "+" : "-"}$${formatMoney(tx.amount)}`;
          const amountClass = isFailed || needsReview
            ? "text-white/45"
            : isIncoming
              ? "text-green-400"
              : "text-red-400";
          const subtitleParts = match
            ? [
                opponentName ? `vs. ${opponentName}` : "Contest transaction",
                timeControl,
                matchReference ? `Match ${matchReference}` : null,
              ]
            : [moment(tx.created_date).format("MMM D, YYYY"), titleCase(tx.status || "completed")];

          return (
            <div
              key={tx.id}
              className={`overflow-hidden rounded-2xl border transition-colors ${
                isExpanded
                  ? "bg-white/[0.045] border-white/10"
                  : "bg-white/[0.03] border-white/5"
              }`}
            >
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : tx.id)}
                aria-expanded={isExpanded}
                className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.025] transition-colors"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center ${config.bg}`}>
                    <Icon size={16} className={config.color} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{config.label}</p>
                    <p className="mt-0.5 truncate text-[11px] text-white/35">
                      {subtitleParts.filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <div className="text-right">
                    <p className={`text-sm font-bold ${amountClass}`}>
                      {amountLabel}
                    </p>
                    <p className="mt-0.5 text-[10px] text-white/25">
                      {moment(tx.created_date).format("h:mm A")}
                    </p>
                  </div>
                  <ChevronDown
                    size={15}
                    className={`text-white/25 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-white/[0.06] px-4 pb-4 pt-3">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${status.className}`}>
                      {status.label}
                    </span>
                    <p className="text-[11px] text-white/30">
                      {moment(tx.created_date).format("MMM D, YYYY [at] h:mm:ss A")}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                    <DetailItem
                      label={tx.status === "completed" ? "Transaction amount" : "Referenced amount"}
                      value={amountLabel}
                    />
                    {match && (
                      <>
                        <DetailItem label="Opponent" value={opponentName || "Opponent"} />
                        <DetailItem label="Time control" value={timeControl} />
                        <DetailItem label="Contest result" value={result} />
                        <DetailItem label="Entry amount" value={`$${formatMoney(match.wager_amount)}`} />
                        <DetailItem label="Platform service fee" value={`$${formatMoney(match.platform_service_fee)}`} />
                        <DetailItem
                          label="Total reserved per player"
                          value={`$${formatMoney((match.wager_amount || 0) + (match.platform_service_fee || 0))}`}
                        />
                      </>
                    )}
                  </div>

                  <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-white/25">{explanation.heading}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/60">{explanation.text}</p>
                  </div>

                  {hasReportableContest && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5">
                      <div>
                        <p className="text-xs font-medium text-white/65">Concern about this contest?</p>
                        <p className="mt-0.5 text-[11px] text-white/30">
                          {canReportContest
                            ? `Reports from wallet history are available until ${moment(reportDeadline).format("MMM D [at] h:mm A")}.`
                            : "The 24-hour reporting window for this transaction has closed."}
                        </p>
                      </div>
                      {canReportContest && (
                        <ReportContestButton
                          matchId={tx.match_id}
                          gameId={match?.game_id}
                          transactionId={tx.id}
                          label="Report this contest"
                          className="rounded-lg border border-white/10 px-3 py-2 font-semibold !text-white/60 hover:bg-white/5 hover:!text-white/85"
                        />
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-white/25">Transaction reference</p>
                      <p className="mt-1 font-mono text-[11px] text-white/45">{transactionReference}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyReference(tx.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white/55 hover:bg-white/5 hover:text-white/80"
                    >
                      {copiedId === tx.id ? <Check size={12} /> : <Copy size={12} />}
                      {copiedId === tx.id ? "Copied" : "Copy ID"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <TransactionPagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
      )}
    </div>
  );
}
