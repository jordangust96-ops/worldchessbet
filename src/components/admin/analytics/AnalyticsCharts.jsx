import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const CHARTS = [
  { key: "traffic", label: "Traffic Over Time", color: "#C9A84C" },
  { key: "registrations", label: "Registrations", color: "#8FBF8F" },
  { key: "deposits", label: "Deposits ($)", color: "#7FB3D5" },
  { key: "matches", label: "Matches", color: "#D48BC9" },
  { key: "revenue", label: "Platform Revenue ($)", color: "#E8D48B" },
  { key: "avgWager", label: "Average Wager ($)", color: "#C97F7F" },
];

export default function AnalyticsCharts({ charts }) {
  if (!charts || charts.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Trends</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {CHARTS.map(({ key, label, color }) => (
          <div key={key} className="rounded-2xl bg-white/[0.03] border border-white/5 p-4">
            <p className="text-xs text-white/50 mb-2">{label}</p>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={charts}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} width={30} />
                <Tooltip contentStyle={{ background: "#0A0A0A", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}