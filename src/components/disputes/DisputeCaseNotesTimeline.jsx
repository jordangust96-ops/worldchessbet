import React from "react";
import moment from "moment";

const ACTION_LABELS = {
  case_created: "Case Created",
  note_added: "Note Added",
  status_changed: "Status Changed",
  escalated: "Escalated",
  dismissed: "Dismissed",
  info_requested: "Information Requested",
  info_submitted: "Information Submitted",
  flagged_fair_play: "Flagged for Fair Play Review",
  flagged_aml: "Flagged for AML Review",
  flagged_manual_settlement: "Flagged for Manual Settlement Review",
  assigned: "Assigned",
  resolved: "Resolved",
};

// Renders a case's DisputeCaseNote audit trail. Used by both the admin case
// detail view (all notes) and the user-facing My Reports view (already
// filtered server-side to visible_to_user notes via RLS).
export default function DisputeCaseNotesTimeline({ notes }) {
  if (notes.length === 0) {
    return <p className="text-xs text-white/30">No updates yet.</p>;
  }

  return (
    <div className="space-y-2.5">
      {notes.map((note) => (
        <div key={note.id} className="rounded-xl bg-white/[0.03] border border-white/5 p-3.5">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-semibold text-white/70">
              {ACTION_LABELS[note.action_type] || note.action_type}
            </span>
            <span className="text-[10px] text-white/30">{moment(note.created_date).format("MMM D, YYYY h:mm A")}</span>
          </div>
          {note.content && <p className="text-xs text-white/60 whitespace-pre-wrap">{note.content}</p>}
          <p className="text-[10px] text-white/25 mt-1.5">
            {note.author_role === "admin" ? "ChessBet Team" : note.author_role === "user" ? "You" : "System"}
          </p>
        </div>
      ))}
    </div>
  );
}