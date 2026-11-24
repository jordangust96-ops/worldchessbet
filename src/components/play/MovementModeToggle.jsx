import React from "react";
import { Move, MousePointer2 } from "lucide-react";

// Compact Drag & Drop / Click to Move selector shown in the live Match HUD.
export default function MovementModeToggle({ mode, onChange }) {
  return (
    <div role="group" aria-label="Movement mode" className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/5 bg-white/[0.03] p-1">
      <button
        type="button"
        onClick={() => onChange("drag")}
        aria-pressed={mode === "drag"}
        className={`flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[11px] font-semibold leading-tight transition-colors ${
          mode === "drag" ? "bg-[#C9A84C] text-black" : "text-white/40 hover:text-white/70"
        }`}
      >
        <Move size={13} className="shrink-0" /> <span>Drag &amp; Drop</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("click")}
        aria-pressed={mode === "click"}
        className={`flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[11px] font-semibold leading-tight transition-colors ${
          mode === "click" ? "bg-[#C9A84C] text-black" : "text-white/40 hover:text-white/70"
        }`}
      >
        <MousePointer2 size={13} className="shrink-0" /> <span>Click to Move</span>
      </button>
    </div>
  );
}