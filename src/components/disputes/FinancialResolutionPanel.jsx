import React from "react";

function Field({ label, value }) {
  return (
    <div>
      <p className="text-white/30">{label}</p>
      <p className="text-white/80 font-semibold">{value}</p>
    </div>
  );
}

// Read-only snapshot of the contest's financial state — the settlement
// picture an admin needs before choosing any corrective action.
export default function FinancialResolutionPanel({ match, contestRecord, contestClearingNet, fundsRecoverable }) {
  const settlementStatus = contestRecord
    ? "Completed"
    : match?.settlement_hold
    ? "On Hold (Investigation)"
    : match?.status === "in_progress"
    ? "Pending — Contest Active"
    : "Not Settled";

  const fmt = (n) => `$${(n || 0).toFixed(2)}`;

  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <Field label="Contest Status" value={match?.status?.replace(/_/g, " ") || "Unknown"} />
      <Field label="Settlement Status" value={settlementStatus} />
      <Field label="Prize Pool" value={fmt(contestRecord?.contest_pool ?? (match?.wager_amount || 0) * 2)} />
      <Field label="Entry Amount" value={fmt(contestRecord?.entry_amount ?? match?.wager_amount)} />
      <Field label="Platform Fee" value={fmt(contestRecord?.platform_fee)} />
      <Field label="Winner Payout" value={fmt(contestRecord?.winner_payout)} />
      <Field label="Contest Clearing Balance (this contest)" value={fmt(contestClearingNet)} />
      <Field label="Withdrawal Status" value={fundsRecoverable ? "Not Withdrawn" : "Withdrawn"} />
      <div className="col-span-2">
        <Field label="Funds Recoverable" value={fundsRecoverable ? "Yes" : "No — already withdrawn"} />
      </div>
    </div>
  );
}