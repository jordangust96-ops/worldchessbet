import React, { useState } from "react";
import { Loader2, RotateCcw, AlertTriangle } from "lucide-react";
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

// Manual pre-launch admin action: resets every non-admin user's account,
// identity, and jurisdiction state to its initial baseline. A confirmation
// dialog must be acknowledged before the backend function is invoked.
export default function ResetUsersForLaunchButton() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await base44.functions.invoke("resetUsersForLaunch", {});
      const data = response?.data ?? response;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      setOpen(false);
    } catch (e) {
      setError(e?.message || "Unable to reset user accounts.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
            <RotateCcw size={17} className="text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Reset Users for Launch</p>
            <p className="mt-1 text-xs leading-5 text-white/40">
              Restores every non-admin account to its provisional, unverified baseline before launch.
              Does not touch wallets or ledger records.
            </p>
          </div>
        </div>

        {result && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-300">
            Reset complete — {result.updated} user(s) updated, {result.skipped_admins} admin(s) skipped.
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
              <RotateCcw size={13} /> Reset all non-admin users
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-400" />
                Reset every non-admin user?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will set account state, identity verification, jurisdiction, and geolocation status
                back to their initial baseline for <strong>every account that is not an admin</strong>.
                Cleared identity and jurisdiction data will need to be re-verified by each player.
                Wallets and ledger records are not affected. This action cannot be undone.
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
                {running ? "Resetting…" : "Yes, reset all users"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}