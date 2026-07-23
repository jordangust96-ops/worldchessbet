import React from "react";

const COLUMNS = [
  { key: "date", label: "Date" },
  { key: "totalVisits", label: "Visits" },
  { key: "uniqueVisits", label: "Unique" },
  { key: "matchesHosted", label: "Hosted" },
  { key: "matchesAccepted", label: "Accepted" },
  { key: "matchesDeclined", label: "Declined" },
  { key: "matchesFinished", label: "Finished" },
  { key: "avgWager", label: "Avg Wager" },
];

// Historical daily breakdown, most recent day first.
export default function SiteActivityTable({ days }) {
  const rows = [...days].reverse();
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {COLUMNS.map((c) => (
              <th key={c.key} className="text-left px-3 py-2.5 text-white/40 uppercase tracking-wider whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="border-b border-white/5 last:border-0">
              <td className="px-3 py-2 text-white/70 whitespace-nowrap">{row.date}</td>
              <td className="px-3 py-2 text-white">{row.totalVisits}</td>
              <td className="px-3 py-2 text-white">{row.uniqueVisits}</td>
              <td className="px-3 py-2 text-white">{row.matchesHosted}</td>
              <td className="px-3 py-2 text-white">{row.matchesAccepted}</td>
              <td className="px-3 py-2 text-white">{row.matchesDeclined}</td>
              <td className="px-3 py-2 text-white">{row.matchesFinished}</td>
              <td className="px-3 py-2 text-[#C9A84C]">${row.avgWager.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}