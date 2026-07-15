// Report category taxonomy for the Contest Reporting framework.
// Subcategories are free-text suggestions surfaced in the report form —
// stored as plain strings on DisputeCase.report_subcategory so new
// subcategories can be added later without a schema change.
export const REPORT_CATEGORIES = {
  fair_play: {
    label: "Fair Play",
    subcategories: [
      "Suspected engine use",
      "AI assistance",
      "External computational aid",
      "Collusion",
      "Intentional losing",
      "Pre-arranged outcomes",
      "Value transfer",
      "Match fixing",
    ],
  },
  harassment: {
    label: "Harassment",
    subcategories: ["Abusive behavior", "Offensive language", "Threats", "Unsportsmanlike conduct"],
  },
  technical_issue: {
    label: "Technical Issue",
    subcategories: [
      "Disconnection",
      "Latency",
      "Platform bug",
      "Incorrect clock behavior",
      "Match synchronization issue",
    ],
  },
  rules_violation: {
    label: "Rules Violation",
    subcategories: ["Official Rules violation", "Terms of Service violation"],
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