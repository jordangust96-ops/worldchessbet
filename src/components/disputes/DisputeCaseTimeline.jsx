import React from "react";
import { User, Shield } from "lucide-react";

// Read-only, chronological render of a case's append-only DisputeCaseNote
// audit trail. Admin-only by RLS — never fetched or shown on the user side.
export default function DisputeCaseTimeline({ notes }) {
  if (notes.length === 0) {
    return <p className="text-xs text-white/30">No activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <div key={note.id} className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-white/[0.05] flex items-center justify-center shrink-0 mt-0.5">
            {note.author_role === "admin" ? (
              <Shield size={13} className="text-[#C9A84C]" />
            ) : (
              <User size={13} className="text-white/40" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-white">{note.author_name || note.author_role}</span>
              <span className="text-[10px] uppercase tracking-wider text-white/30">{note.note_type.replace(/_/g, " ")}</span>
              <span className="text-[10px] text-white/20">{new Date(note.created_date).toLocaleString()}</span>
            </div>
            <p className="text-xs text-white/60 mt-0.5 whitespace-pre-wrap">{note.content}</p>
            {note.new_status && (
              <p className="text-[10px] text-white/30 mt-0.5">
                {note.previous_status} → {note.new_status}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}