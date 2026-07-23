import React from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";

const ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

export default function DevicesPanel({ devices }) {
  if (!devices) return null;
  const total = devices.reduce((s, d) => s + d.sessions, 0) || 1;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Devices</p>
      <div className="grid grid-cols-3 gap-3">
        {devices.map((d) => {
          const Icon = ICONS[d.category.toLowerCase()] || Monitor;
          const pct = Math.round((d.sessions / total) * 100);
          return (
            <div key={d.category} className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 text-center">
              <Icon size={18} className="text-[#C9A84C] mx-auto mb-2" />
              <p className="text-lg font-bold text-white">{pct}%</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider capitalize">{d.category}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}