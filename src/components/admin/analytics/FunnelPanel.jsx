import React from "react";

export default function FunnelPanel({ funnel }) {
  if (!funnel || funnel.length === 0) return null;
  const maxCount = Math.max(...funnel.map((f) => f.count || 0), 1);

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Conversion Funnel</p>
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
        {funnel.map((f) => {
          const width = f.count == null ? 0 : Math.max(4, Math.round((f.count / maxCount) * 100));
          return (
            <div key={f.step}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-white/70">{f.step}</span>
                <span className="text-white font-semibold">
                  {f.count == null ? "—" : f.count}
                  {f.conversionRate != null && <span className="text-white/30 ml-2">({f.conversionRate}%)</span>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full gold-gradient" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}