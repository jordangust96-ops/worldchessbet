import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

// Admin action bar for a single case. Every action posts through
// manageDisputeCase, which appends an immutable note and never touches the
// underlying contest's outcome or any balance.
export default function DisputeCaseActionsPanel({ disputeCase, onChanged }) {
  const [notes, setNotes] = useState("");
  const [busyAction, setBusyAction] = useState(null);

  const runAction = async (action, { requireNotes = false } = {}) => {
    if (requireNotes && !notes.trim()) return;
    setBusyAction(action);
    try {
      await base44.functions.invoke("manageDisputeCase", { caseId: disputeCase.id, action, notes });
      setNotes("");
      onChanged?.();
    } finally {
      setBusyAction(null);
    }
  };

  const isClosed = disputeCase.status === "resolved" || disputeCase.status === "closed";

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Administrative Actions</p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (required for some actions, e.g. Resolve, Request Info)..."
        rows={2}
        className="w-full p-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction}
          onClick={() => runAction("add_note", { requireNotes: true })}
          className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
        >
          {busyAction === "add_note" && <Loader2 size={12} className="animate-spin mr-1" />}
          Add Note
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction || isClosed}
          onClick={() => runAction("mark_under_review")}
          className="h-8 rounded-lg text-xs border-blue-500/20 text-blue-400 hover:bg-blue-500/5 bg-transparent"
        >
          {busyAction === "mark_under_review" && <Loader2 size={12} className="animate-spin mr-1" />}
          Mark Under Review
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction || isClosed}
          onClick={() => runAction("escalate")}
          className="h-8 rounded-lg text-xs border-red-500/20 text-red-400 hover:bg-red-500/5 bg-transparent"
        >
          {busyAction === "escalate" && <Loader2 size={12} className="animate-spin mr-1" />}
          Escalate
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction || isClosed}
          onClick={() => runAction("request_info", { requireNotes: true })}
          className="h-8 rounded-lg text-xs border-amber-500/20 text-amber-400 hover:bg-amber-500/5 bg-transparent"
        >
          {busyAction === "request_info" && <Loader2 size={12} className="animate-spin mr-1" />}
          Request Additional Information
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction}
          onClick={() => runAction("flag_fair_play")}
          className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
        >
          {busyAction === "flag_fair_play" && <Loader2 size={12} className="animate-spin mr-1" />}
          Flag for Fair Play Review
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction}
          onClick={() => runAction("flag_aml")}
          className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
        >
          {busyAction === "flag_aml" && <Loader2 size={12} className="animate-spin mr-1" />}
          Flag for AML Review
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction}
          onClick={() => runAction("flag_manual_settlement")}
          className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
        >
          {busyAction === "flag_manual_settlement" && <Loader2 size={12} className="animate-spin mr-1" />}
          Flag for Manual Settlement Review
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction}
          onClick={() => runAction("assign")}
          className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
        >
          {busyAction === "assign" && <Loader2 size={12} className="animate-spin mr-1" />}
          Assign to Me
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busyAction || isClosed}
          onClick={() => runAction("dismiss", { requireNotes: false })}
          className="h-8 rounded-lg text-xs border-white/10 text-white/60 hover:text-white bg-transparent"
        >
          {busyAction === "dismiss" && <Loader2 size={12} className="animate-spin mr-1" />}
          Dismiss
        </Button>
        <Button
          size="sm"
          disabled={!!busyAction || isClosed}
          onClick={() => runAction("resolve", { requireNotes: true })}
          className="h-8 rounded-lg text-xs gold-gradient text-black font-bold hover:opacity-90"
        >
          {busyAction === "resolve" && <Loader2 size={12} className="animate-spin mr-1" />}
          Resolve
        </Button>
      </div>
    </div>
  );
}