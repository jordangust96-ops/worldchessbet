import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

const TYPE_LABELS = { match_entry: "Hold", match_release: "Release", match_settlement: "Settlement", platform_fee: "Platform Fee", refund: "Refund", reversal: "Reversal", investigation_hold: "Investigation Hold", investigation_hold_release: "Hold Released" };

function LedgerRow({ entry }) {
  const [open, setOpen] = useState(false);
  const net = (entry.credit_amount || 0) - (entry.debit_amount || 0);
  return (
    <div className="border-b border-white/5 last:border-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-2 text-xs">
        <div className="flex items-center gap-2">
          <ChevronDown size={12} className={`text-white/30 transition-transform ${open ? "rotate-180" : ""}`} />
          <span className="text-white/70">{TYPE_LABELS[entry.transaction_type] || entry.transaction_type?.replace(/_/g, " ")}</span>
        </div>
        <span className={net >= 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
          {net >= 0 ? "+" : ""}${net.toFixed(2)}
        </span>
      </button>
      {open && (
        <div className="pb-2 pl-5 grid grid-cols-2 gap-1 text-[11px] text-white/50">
          <p>Account: <span className="text-white/70">{entry.ledger_account}</span></p>
          <p>Actor: <span className="text-white/70">{entry.initiating_actor}</span></p>
          <p>Debit: <span className="text-white/70">${(entry.debit_amount || 0).toFixed(2)}</span></p>
          <p>Credit: <span className="text-white/70">${(entry.credit_amount || 0).toFixed(2)}</span></p>
          <p>Resulting Available: <span className="text-white/70">{entry.resulting_available_balance != null ? `$${entry.resulting_available_balance.toFixed(2)}` : "—"}</span></p>
          <p>Resulting Held: <span className="text-white/70">{entry.resulting_held_balance != null ? `$${entry.resulting_held_balance.toFixed(2)}` : "—"}</span></p>
          <p className="col-span-2">Trigger: <span className="text-white/70">{entry.trigger_event}</span></p>
          <p className="col-span-2 text-white/30">{new Date(entry.created_date).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}

// Expandable ledger preview — replaces the old static "N Ledger Entries
// Linked" count with an inspectable list, click any row for full detail.
export default function LedgerEntriesPanel({ entries }) {
  if (!entries || entries.length === 0) {
    return <p className="text-xs text-white/30">No ledger entries linked to this contest yet.</p>;
  }
  return (
    <div>
      <p className="text-xs text-white/50 mb-1">{entries.length} Ledger {entries.length === 1 ? "Entry" : "Entries"} Linked</p>
      <div>
        {entries.map((e) => (
          <LedgerRow key={e.id} entry={e} />
        ))}
      </div>
    </div>
  );
}