import React from "react";

const BUCKET_ORDER = ["Organic Search", "Direct", "Referral", "Reddit", "TikTok", "Google Ads", "Facebook", "X", "Other"];

export default function AcquisitionPanel({ acquisition }) {
  if (!acquisition) return null;
  const buckets = acquisition.buckets || {};
  const total = Object.values(buckets).reduce((s, v) => s + v, 0) || 1;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Acquisition</p>
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-2">
        {BUCKET_ORDER.map((key) => {
          const value = buckets[key] || 0;
          const pct = Math.round((value / total) * 100);
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs text-white/60 w-32 shrink-0">{key}</span>
              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full gold-gradient" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-white w-16 text-right">
                {value} <span className="text-white/30">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}