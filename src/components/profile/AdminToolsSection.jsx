import React from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  BellRing,
  ChevronRight,
  FilePenLine,
  Gavel,
  Lock,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserRoundSearch,
} from "lucide-react";
import ResetUsersForLaunchButton from "@/components/profile/ResetUsersForLaunchButton";

const SITE_ACTIVITY_ADMIN_EMAIL = "jordangust96@gmail.com";

const reviewTools = [
  {
    to: "/admin/actions",
    icon: BellRing,
    label: "Admin Action Center",
    description: "See prioritized reports and flags with evidence-based next-step guidance.",
  },
  {
    to: "/admin/user-financials",
    icon: UserRoundSearch,
    label: "Player & Financial Review",
    description: "Search any player and open their integrity, account, and financial record.",
  },
  {
    to: "/admin/integrity",
    icon: ShieldCheck,
    label: "Integrity Review Queue",
    description: "Review active fair-play and identity flags.",
  },
  {
    to: "/admin/disputes",
    icon: Gavel,
    label: "Dispute Case Queue",
    description: "Investigate and resolve player-reported cases.",
  },
];

const policyTools = [
  { to: "/admin/privacy-policy", label: "Privacy Policy" },
  { to: "/admin/terms-of-service", label: "Terms of Service" },
  { to: "/admin/official-rules", label: "Official Rules" },
];

function ToolCard({ to, icon: Icon, label, description }) {
  return (
    <Link
      to={to}
      className="group flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 hover:border-[#C9A84C]/25 hover:bg-[#C9A84C]/[0.06] transition-colors"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <Icon size={17} className="text-[#C9A84C]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs leading-5 text-white/40">{description}</p>
        </div>
      </div>
      <ChevronRight size={16} className="mt-2 text-white/20 group-hover:text-[#C9A84C]/70 shrink-0" />
    </Link>
  );
}

export default function AdminToolsSection({ userEmail }) {
  return (
    <section className="rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/[0.045] p-5 space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <Lock size={18} className="text-[#C9A84C]" />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-[#C9A84C] uppercase tracking-wider">Admin only</p>
          <h2 className="mt-1 text-base font-bold text-white">Player & Integrity Administration</h2>
          <p className="mt-1 text-xs leading-5 text-white/40">
            Private review, case management, and operational controls. No tools in this panel are visible to players.
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Review & case management
        </p>
        <div className="grid grid-cols-1 gap-2">
          {reviewTools.map((tool) => <ToolCard key={tool.to} {...tool} />)}
        </div>
      </div>

      <div>
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">Operations</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ToolCard
            to="/admin/game-settings"
            icon={Settings2}
            label="Game & Clock Settings"
            description="Manage reconnect grace and game timing safeguards."
          />
          {userEmail === SITE_ACTIVITY_ADMIN_EMAIL && (
            <ToolCard
              to="/admin/site-activity"
              icon={BarChart3}
              label="Site Activity"
              description="View traffic and platform activity metrics."
            />
          )}
        </div>

        <div className="mt-2">
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            Pre-launch
          </p>
          <ResetUsersForLaunchButton />
        </div>
      </div>

      <div>
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Policy management
        </p>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.06] overflow-hidden">
          {policyTools.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.035] transition-colors"
            >
              <div className="flex items-center gap-3">
                {label === "Official Rules" ? (
                  <ScrollText size={15} className="text-white/35" />
                ) : (
                  <FilePenLine size={15} className="text-white/35" />
                )}
                <span className="text-sm text-white/70">Manage {label}</span>
              </div>
              <ChevronRight size={15} className="text-white/20" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}