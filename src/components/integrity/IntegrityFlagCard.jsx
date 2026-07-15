import React, { useState } from "react";
import moment from "moment";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { SeverityBadge, StatusBadge } from "@/components/integrity/IntegrityBadges";
import { FLAG_TYPE_LABELS } from "@/lib/integrityLabels";

export default function IntegrityFlagCard({ flag, withdrawalHold, onChanged }) {
  const [notes, setNotes] = useState("");
  const [busyAction, setBusyAction] = useState(null);

  const runAction = async (action) => {
    setBusyAction(action);
    try {
      await base44.functions.invoke("manageIntegrityFlag", { flagId: flag.id, action, notes });
      setNotes("");
      onChanged?.();
    } finally {
      setBusyAction(null);
    }
  };

  const isResolved = flag.status === "cleared" || flag.status === "action_taken";

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={flag.severity} />
          <StatusBadge status={flag.status} />
        </div>
        <p className="text-[11px] text-white/30">{moment(flag.created_date).format("MMM D, YYYY h:mm A")}</p>
      </div>

      <p className="text-sm font-semibold text-white">{FLAG_TYPE_LABELS[flag.flag_type] || flag.flag_type}</p>
      {flag.match_id && <p className="text-[11px] text-white/40">Linked contest: {flag.match_id}</p>}
      {flag.notes && <p className="text-xs text-white/50 whitespace-pre-wrap">{flag.notes}</p>}
      {flag.action_taken && (
        <p className="text-xs text-white/70">
          <span className="text-white/40">Action taken: </span>
          {flag.action_taken}
        </p>
      )}

      {!isResolved && (
        <>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add investigation notes..."
            rows={2}
            className="w-full p-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!busyAction}
              onClick={() => runAction("mark_under_review")}
              className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
            >
              {busyAction === "mark_under_review" && <Loader2 size={12} className="animate-spin mr-1" />}
              Mark Under Review
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busyAction}
              onClick={() => runAction("mark_cleared")}
              className="h-8 rounded-lg text-xs border-green-500/20 text-green-400 hover:bg-green-500/5 bg-transparent"
            >
              {busyAction === "mark_cleared" && <Loader2 size={12} className="animate-spin mr-1" />}
              Mark Cleared
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busyAction}
              onClick={() => runAction("mark_action_taken")}
              className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
            >
              {busyAction === "mark_action_taken" && <Loader2 size={12} className="animate-spin mr-1" />}
              Mark Action Taken
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busyAction}
              onClick={() => runAction("add_notes")}
              className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
            >
              {busyAction === "add_notes" && <Loader2 size={12} className="animate-spin mr-1" />}
              Add Notes
            </Button>
            {withdrawalHold ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!!busyAction}
                onClick={() => runAction("unfreeze_withdrawals")}
                className="h-8 rounded-lg text-xs border-[#C9A84C]/30 text-[#C9A84C] hover:bg-[#C9A84C]/5 bg-transparent"
              >
                {busyAction === "unfreeze_withdrawals" && <Loader2 size={12} className="animate-spin mr-1" />}
                Unfreeze Withdrawals
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={!!busyAction}
                onClick={() => runAction("freeze_withdrawals")}
                className="h-8 rounded-lg text-xs border-red-500/20 text-red-400 hover:bg-red-500/5 bg-transparent"
              >
                {busyAction === "freeze_withdrawals" && <Loader2 size={12} className="animate-spin mr-1" />}
                Freeze Withdrawals
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!!busyAction}
              onClick={() => runAction("request_identity_verification")}
              className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
            >
              {busyAction === "request_identity_verification" && <Loader2 size={12} className="animate-spin mr-1" />}
              Request Identity Verification
            </Button>
          </div>
        </>
      )}
    </div>
  );
}