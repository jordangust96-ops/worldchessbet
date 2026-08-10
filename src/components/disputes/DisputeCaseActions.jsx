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
        <Button size="sm" variant="outline" disabled={busy || disputeCase.status === "under_review"} onClick={() => run("change_status", { status: "under_review" })} className="border-white/10 text-white/50">
          Start Review
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
        <p className="text-xs text-white/50">Resolve — No Violation</p>
        <p className="text-[10px] leading-4 text-white/35">
          Use only after reviewing the evidence. This creates the formal audited resolution and closes the case without enforcement.
        </p>
        <Textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="Internal rationale supporting a no-violation decision..."
          className="bg-white/[0.03] border-white/10 text-white text-xs min-h-[70px]"
        />
        <Button
          size="sm"
          disabled={busy || !resolution.trim()}
          onClick={() => {
            if (window.confirm("Resolve this case as no violation? This records a formal resolution and closes the case.")) {
              run("resolve_case", {
                resolutionType: "no_violation",
                internalRationale: resolution,
                userFacingSummary: "Review completed. No violation was found.",
              });
            }
          }}
          className="bg-emerald-500/90 text-black font-semibold hover:opacity-90"
        >
          Resolve as No Violation
        </Button>
      </div>
    </div>
  );
}