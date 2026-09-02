import React, { useState } from "react";
import { Loader2, Undo2, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Manual pre-launch admin action: offsets every historical settlement
// LedgerEntry (pre-launch test artifacts) by writing one new reversal entry
// per original. Does not modify or delete existing rows, and does not touch
// wallets or system ledger accounts. A confirmation dialog must be accepted
// before the backend function is invoked.
export default function ReverseLegacyLedgerTestDataButton() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await base44.functions.invoke("reverseLegacyLedgerTestData", {});
      const data = response?.data ?? response;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      setOpen(false);
    } catch (e) {
      setError(e?.message || "Unable to reverse legacy ledger test data.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
          <Undo2 size={17} className="text-red-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Reverse Legacy Ledger Test Data</p>
          <p className="mt-1 text-xs leading-5 text-white/40">
            Offsets every historical settlement ledger entry with a new reversal entry. Existing rows
            are never modified or deleted; wallets and system accounts are not touched.
          </p>
        </div>
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-300">
          {result.created} reversal(s) created · {result.already_reversed_skipped} already reversed (skipped) · $
          {result.total_amount_reversed} reversed.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setError(""); setResult(null); } }}>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/[0.14] transition-colors"
          >
            <Undo2 size={13} /> Reverse legacy settlement test data
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-400" />
              Reverse all legacy settlement test data?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This writes one new reversal ledger entry for every existing settlement ledger row,
              offsetting the pre-launch test data so the daily ledger invariant balances again. No
              existing row is edited or deleted, and no wallet or system account is changed. The
              action is safely re-runnable — entries already reversed are skipped. This cannot be
              undone, but has no effect on real player balances.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={running}
              className="bg-red-600 text-white hover:bg-red-600/90"
            >
              {running ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              {running ? "Reversing…" : "Yes, reverse test data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}