import React from "react";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "custom", label: "Custom Range" },
];

// Preset buttons + custom date inputs (shown only when "custom" is selected).
export default function TimeRangeFilter({ preset, customStart, customEnd, onPresetChange, onCustomChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          onClick={() => onPresetChange(p.key)}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
            preset === p.key
              ? "bg-[#C9A84C] text-black border-[#C9A84C]"
              : "bg-white/[0.03] text-white/60 border-white/10 hover:bg-white/[0.06]"
          }`}
        >
          {p.label}
        </button>
      ))}
      {preset === "custom" && (
        <div className="flex items-center gap-2 ml-1">
          <input
            type="date"
            value={customStart}
            onChange={(e) => onCustomChange(e.target.value, customEnd)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
          />
          <span className="text-white/30 text-xs">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => onCustomChange(customStart, e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
          />
        </div>
      )}
    </div>
  );
}