import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";

// Administrative action panel — every action creates an append-only audit
// note; none of these ever touch the underlying contest outcome or balances.
export default function DisputeCaseActions({ disputeCase, onChanged }) {
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action, payload = {}) => {
    setBusy(true);
    try {
      await base44.functions.invoke("manageDisputeCase", { caseId: disputeCase.id, action, payload });
      setNote("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("assign_to_me")} className="border-white/10 text-white/70">
          Assign to Me
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("escalate")} className="border-white/10 text-red-400/80">
          Escalate
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("request_information")} className="border-white/10 text-amber-400/80">
          Request Info
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("dismiss")} className="border-white/10 text-white/50">
          Dismiss
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("flag_fair_play_review")} className="border-white/10 text-white/70">
          Flag Fair Play
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("flag_aml_review")} className="border-white/10 text-white/70">
          Flag AML
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("flag_manual_settlement_review")} className="border-white/10 text-white/70 col-span-2">
          Flag Manual Settlement Review
        </Button>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-white/50">Add Note</p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Investigation notes..."
          className="bg-white/[0.03] border-white/10 text-white text-xs min-h-[70px]"
        />
        <Button size="sm" disabled={busy || !note.trim()} onClick={() => run("add_note", { content: note })} className="gold-gradient text-black font-semibold hover:opacity-90">
          Save Note
        </Button>
      </div>

      <div className="space-y-1.5 pt-2 border-t border-white/5">
        <p className="text-xs text-white/50">Resolve Case</p>
        <Textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="Resolution summary..."
          className="bg-white/[0.03] border-white/10 text-white text-xs min-h-[70px]"
        />
        <Button
          size="sm"
          disabled={busy || !resolution.trim()}
          onClick={() => run("set_resolution", { resolution })}
          className="bg-emerald-500/90 text-black font-semibold hover:opacity-90"
        >
          Mark Resolved
        </Button>
      </div>
    </div>
  );
}