import React from "react";
import { ArrowUpRight, ArrowDownLeft, Plus, Minus } from "lucide-react";
import moment from "moment";
import TransactionPagination from "@/components/wallet/TransactionPagination";

const typeConfig = {
  deposit: { icon: ArrowDownLeft, color: "text-green-400", bg: "bg-green-500/10", label: "Fund Account" },
  withdrawal: { icon: ArrowUpRight, color: "text-red-400", bg: "bg-red-500/10", label: "Withdraw Funds" },
  wager_lock: { icon: Minus, color: "text-orange-400", bg: "bg-orange-500/10", label: "Contest Entry Reserved" },
  wager_refund: { icon: Plus, color: "text-blue-400", bg: "bg-blue-500/10", label: "Contest Entry Refund" },
  payout: { icon: ArrowDownLeft, color: "text-[#C9A84C]", bg: "bg-[#C9A84C]/10", label: "Contest Winnings" },
  service_fee_charge: { icon: Minus, color: "text-orange-400", bg: "bg-orange-500/10", label: "Platform Service Fee" },
  service_fee_refund: { icon: Plus, color: "text-blue-400", bg: "bg-blue-500/10", label: "Platform Service Fee Refund" },
};

// Renders one page of transactions plus pagination controls. Data fetching /
// page-size logic lives in the parent (WalletPage) — this component is purely
// presentational so future additions (search, filters, export, infinite
// scroll) can be layered on the parent without touching this file.
export default function TransactionHistory({ transactions, page, pageSize, totalCount, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

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
          const isIncoming = ["deposit", "payout", "wager_refund", "service_fee_refund"].includes(tx.type);
          return (
            <div
              key={tx.id}
              className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5"
            >
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${config.bg}`}>
                  <Icon size={16} className={config.color} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{config.label}</p>
                  <p className="text-[11px] text-white/30">
                    {moment(tx.created_date).format("MMM D, YYYY")}
                  </p>
                </div>
              </div>
              <p className={`text-sm font-bold ${isIncoming ? "text-green-400" : "text-red-400"}`}>
                {isIncoming ? "+" : "-"}${tx.amount?.toFixed(2)}
              </p>
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