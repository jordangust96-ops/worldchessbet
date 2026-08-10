import React from "react";
import { Volume2, VolumeX } from "lucide-react";

export default function SoundToggle({
  enabled,
  onChange,
  compact = false,
  disabled = false,
}) {
  const Icon = enabled ? Volume2 : VolumeX;

  if (compact) {
    return (
      <button
        type="button"
        aria-label={enabled ? "Mute match sounds" : "Enable match sounds"}
        aria-pressed={enabled}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
          enabled
            ? "border-[#C9A84C]/25 bg-[#C9A84C]/[0.07] text-[#C9A84C]"
            : "border-white/10 bg-white/[0.025] text-white/40"
        }`}
      >
        <Icon size={14} />
        {enabled ? "Sound on" : "Sound off"}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          enabled ? "bg-[#C9A84C]/10 text-[#C9A84C]" : "bg-white/[0.05] text-white/35"
        }`}>
          <Icon size={17} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Game sounds</p>
          <p className="mt-0.5 text-xs leading-5 text-white/40">
            Match acceptance, moves, and game results.
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Game sounds"
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
          enabled
            ? "border-[#C9A84C]/40 bg-[#C9A84C]/30"
            : "border-white/10 bg-white/[0.06]"
        }`}
      >
        <span
          className={`absolute top-1 h-[18px] w-[18px] rounded-full transition-all ${
            enabled ? "left-[25px] bg-[#C9A84C]" : "left-1 bg-white/45"
          }`}
        />
      </button>
    </div>
  );
}
