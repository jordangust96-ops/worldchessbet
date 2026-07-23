import React from "react";

// Generic reusable metric-card grid used for both GA4 and internal metrics.
export default function MetricCardGrid({ title, metrics }) {
  return (
    <div>
      {title && <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">{title}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {metrics.map(({ label, value }) => (
          <div key={label} className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 text-center">
            <p className="text-lg font-bold text-white">{value}</p>
            <p className="text-[10px] text-white/40 uppercase tracking-wider mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}