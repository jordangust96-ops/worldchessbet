import React from "react";

// The only valid preset Contest Entry Amounts and their fixed-dollar
// Platform Service Fee per player. Values mirror base44/shared/platformFee.ts
// (schedule version 2026-07-28) — display only; the backend remains authoritative.
const FEE_ROWS = [
  { entry: "$5", fee: "$1" },
  { entry: "$10", fee: "$1" },
  { entry: "$25", fee: "$2" },
  { entry: "$50", fee: "$4" },
  { entry: "$100", fee: "$6" },
  { entry: "$250", fee: "$10" },
  { entry: "$500", fee: "$15" },
  { entry: "$1,000", fee: "$20" },
  { entry: "$2,500", fee: "$30" },
  { entry: "$5,000", fee: "$40" },
];

// Accessible, responsive two-column schedule table for the Official Rules.
// Uses real table semantics (caption, scoped headers) and scrolls horizontally
// only if a viewport is too narrow to hold both columns.
export default function PlatformServiceFeeScheduleTable() {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-collapse text-sm">
        <caption className="px-2 pb-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">
          Platform Service Fee Schedule
        </caption>
        <thead>
          <tr className="border-b border-white/10">
            <th scope="col" className="py-2 pr-4 text-left font-semibold text-white/80 whitespace-nowrap">
              Contest Entry Amount
            </th>
            <th scope="col" className="py-2 pl-4 text-right font-semibold text-white/80 whitespace-nowrap">
              Platform Service Fee (per player)
            </th>
          </tr>
        </thead>
        <tbody>
          {FEE_ROWS.map((row) => (
            <tr key={row.entry} className="border-b border-white/5 last:border-b-0">
              <th scope="row" className="py-2 pr-4 text-left font-medium text-white/70 whitespace-nowrap">
                {row.entry}
              </th>
              <td className="py-2 pl-4 text-right text-white/70 whitespace-nowrap">
                {row.fee}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}