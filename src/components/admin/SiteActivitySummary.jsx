import React from "react";
import { Users, UserCheck, Swords, CheckCircle2, XCircle, Trophy, DollarSign } from "lucide-react";

const CARDS = [
  { key: "totalVisits", label: "Total Visits", icon: Users },
  { key: "uniqueVisits", label: "Unique Visits", icon: UserCheck },
  { key: "matchesHosted", label: "Matches Hosted", icon: Swords },
  { key: "matchesAccepted", label: "Matches Accepted", icon: CheckCircle2 },
  { key: "matchesDeclined", label: "Matches Declined", icon: XCircle },
  { key: "matchesFinished", label: "Matches Finished", icon: Trophy },
];

// Highlights today's numbers so the admin doesn't have to scan the table.
export default function SiteActivitySummary({ today }) {
  if (!today) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {CARDS.map(({ key, label, icon: Icon }) => (
        <div key={key} className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 text-center">
          <Icon size={18} className="text-[#C9A84C] mx-auto mb-2" />
          <p className="text-lg font-bold text-white">{today[key]}</p>
          <p className="text-[10px] text-white/40 uppercase tracking-wider">{label}</p>
        </div>
      ))}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 text-center">
        <DollarSign size={18} className="text-[#C9A84C] mx-auto mb-2" />
        <p className="text-lg font-bold text-white">${today.avgWager.toFixed(2)}</p>
        <p className="text-[10px] text-white/40 uppercase tracking-wider">Avg Wager Today</p>
      </div>
    </div>
  );
}