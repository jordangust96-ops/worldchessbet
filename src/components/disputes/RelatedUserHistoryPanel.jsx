import React from "react";

function StatColumn({ label, stats }) {
  if (!stats) return <div className="text-xs text-white/30">{label}: not applicable.</div>;
  const rows = [
    ["Completed Matches", stats.completedMatches],
    ["Disputes Filed", stats.disputesFiled],
    ["Disputes Against", stats.disputesAgainst],
    ["Confirmed Violations", stats.confirmedViolations],
    ["Account Warnings", stats.warnings],
    ["Prior Suspensions", stats.priorSuspensions],
  ];
  return (
    <div>
      <p className="text-xs font-semibold text-white mb-1.5">{label}</p>
      <div className="space-y-1">
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between text-[11px]">
            <span className="text-white/40">{l}</span>
            <span className={v > 0 ? "text-white/80 font-semibold" : "text-white/50"}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Lets an investigator spot patterns across both players without leaving
// the case page — read-only aggregate counts.
export default function RelatedUserHistoryPanel({ reportingPlayer, reportedPlayer }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <StatColumn label={reportingPlayer?.name ? `Reporting User (${reportingPlayer.name})` : "Reporting User"} stats={reportingPlayer?.stats} />
      <StatColumn label={reportedPlayer?.name ? `Reported User (${reportedPlayer.name})` : "Reported User"} stats={reportedPlayer?.stats} />
    </div>
  );
}