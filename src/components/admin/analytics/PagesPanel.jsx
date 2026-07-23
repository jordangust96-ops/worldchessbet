import React from "react";

function PageList({ title, items, valueKey, suffix = "" }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4">
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-white/30">No data</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.path} className="flex items-center justify-between text-xs gap-2">
              <span className="text-white/70 truncate">{item.path}</span>
              <span className="text-white font-semibold shrink-0">
                {item[valueKey]}
                {suffix}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PagesPanel({ pages }) {
  if (!pages) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Pages</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PageList title="Top Landing Pages" items={pages.landingPages || []} valueKey="sessions" />
        <PageList title="Top Exit Pages" items={pages.exitPages || []} valueKey="views" />
        <PageList title="Avg Time Per Page" items={pages.avgTimePerPage || []} valueKey="avgSeconds" suffix="s" />
      </div>
    </div>
  );
}