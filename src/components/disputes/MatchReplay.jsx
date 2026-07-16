import React, { useState } from "react";
import { Chessboard } from "react-chessboard";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";

// Read-only, step-through replay of the contest's recorded move log. Never
// allows editing — purely for investigation.
export default function MatchReplay({ moveLog, finalFen }) {
  const hasLog = Array.isArray(moveLog) && moveLog.length > 0;
  const [index, setIndex] = useState(hasLog ? moveLog.length - 1 : 0);

  if (!hasLog) {
    return (
      <div className="text-center py-4">
        <div className="w-40 mx-auto mb-2">
          <Chessboard position={finalFen || "start"} arePiecesDraggable={false} />
        </div>
        <p className="text-xs text-white/30">Move-by-move replay unavailable for this contest — showing final position only.</p>
      </div>
    );
  }

  const current = moveLog[index];
  const moveNumber = Math.ceil(current.ply / 2);

  return (
    <div>
      <div className="w-52 mx-auto mb-3">
        <Chessboard position={current.fen_after} arePiecesDraggable={false} />
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-white/60 mb-2">
        <span>Move {moveNumber}</span>
        <span className="text-white/30">·</span>
        <span className="font-mono">{current.san}</span>
        <span className="text-white/30">·</span>
        <span className="text-white/30">{current.timestamp ? new Date(current.timestamp).toLocaleTimeString() : "—"}</span>
      </div>
      <div className="flex items-center justify-center gap-1.5">
        <button onClick={() => setIndex(0)} disabled={index === 0} className="p-1.5 rounded-lg bg-white/5 disabled:opacity-30 text-white/70"><ChevronsLeft size={14} /></button>
        <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} className="p-1.5 rounded-lg bg-white/5 disabled:opacity-30 text-white/70"><ChevronLeft size={14} /></button>
        <button onClick={() => setIndex((i) => Math.min(moveLog.length - 1, i + 1))} disabled={index === moveLog.length - 1} className="p-1.5 rounded-lg bg-white/5 disabled:opacity-30 text-white/70"><ChevronRight size={14} /></button>
        <button onClick={() => setIndex(moveLog.length - 1)} disabled={index === moveLog.length - 1} className="p-1.5 rounded-lg bg-white/5 disabled:opacity-30 text-white/70"><ChevronsRight size={14} /></button>
      </div>
    </div>
  );
}