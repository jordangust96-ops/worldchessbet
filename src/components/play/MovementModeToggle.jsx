import React from "react";
import { Move, MousePointer2 } from "lucide-react";

// Compact Drag & Drop / Click to Move selector shown in the live Match HUD.
export default function MovementModeToggle({ mode, onChange }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/5">
      <button
        onClick={() => onChange("drag")}
        className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[11px] font-semibold transition-colors ${
          mode === "drag" ? "bg-[#C9A84C] text-black" : "text-white/40 hover:text-white/70"
        }`}
      >
        <Move size={13} /> Drag & Drop
      </button>
      <button
        onClick={() => onChange("click")}
        className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[11px] font-semibold transition-colors ${
          mode === "click" ? "bg-[#C9A84C] text-black" : "text-white/40 hover:text-white/70"
        }`}
      >
        <MousePointer2 size={13} /> Click to Move
      </button>
    </div>
  );
}