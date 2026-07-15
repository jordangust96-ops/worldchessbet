// Shared display labels/styles for the Contest Reporting & Dispute
// Management framework — kept in one place so the report form, My Reports,
// and admin dispute queue/detail pages stay consistent.

export const REPORT_CATEGORIES = {
  fair_play: {
    label: "Fair Play",
    subcategories: ["Suspected Engine Use", "AI Assistance", "External Computational Aid"],
  },
  collusion: {
    label: "Collusion",
    subcategories: ["Intentional Losing", "Pre-arranged Outcomes", "Value Transfer", "Match Fixing"],
  },
  harassment: {
    label: "Harassment",
    subcategories: ["Abusive Behavior", "Offensive Language", "Threats", "Unsportsmanlike Conduct"],
  },
  technical_issue: {
    label: "Technical Issue",
    subcategories: [
      "Disconnection",
      "Latency",
      "Platform Bug",
      "Incorrect Clock Behavior",
      "Match Synchronization Issue",
    ],
  },
  rules_violation: {
    label: "Rules Violation",
    subcategories: ["Official Rules Violation", "Terms of Service Violation"],
  },
  other: {
    label: "Other",
    subcategories: [],
  },
};

export const CASE_STATUS_LABELS = {
  open: "Open",
  under_review: "Under Review",
  awaiting_information: "Awaiting Information",
  resolved: "Resolved",
  closed: "Closed",
};

export const CASE_STATUS_STYLES = {
  open: "bg-[#C9A84C]/10 text-[#C9A84C] border-[#C9A84C]/20",
  under_review: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  awaiting_information: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  resolved: "bg-green-500/10 text-green-400 border-green-500/20",
  closed: "bg-white/10 text-white/60 border-white/15",
};

export const CASE_PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

export const CASE_PRIORITY_STYLES = {
  high: "bg-red-500/10 text-red-400 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-white/5 text-white/50 border-white/10",
};