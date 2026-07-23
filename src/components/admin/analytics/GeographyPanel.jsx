import React from "react";

function List({ title, items }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4">
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-white/30">No data</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.name} className="flex items-center justify-between text-xs">
              <span className="text-white/70 truncate">{item.name}</span>
              <span className="text-white font-semibold">{item.activeUsers}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GeographyPanel({ geography }) {
  if (!geography) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Geography</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <List title="Countries" items={geography.countries || []} />
        <List title="States" items={geography.states || []} />
        <List title="Cities" items={geography.cities || []} />
      </div>
    </div>
  );
}