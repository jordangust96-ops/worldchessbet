// Structured content for the Fair Play & Integrity policy page. Kept separate
// from the page component so the (lengthy) policy text can be updated without
// touching layout/rendering logic.

export const PROHIBITED_CATEGORIES = [
  {
    title: "Gameplay",
    items: [
      "Using chess engines during a live contest.",
      "Using AI assistance of any kind to determine moves.",
      "Using position analysis tools during a live contest.",
      "Using browser extensions that provide move suggestions.",
      "Using automation, bots, or macros to play or assist moves.",
      "Using any external software assistance not built into ChessBet.",
      "Receiving human coaching or advice from another person during a live contest.",
    ],
  },
  {
    title: "Account Abuse",
    items: [
      "Sharing an account with another person.",
      "Buying or selling ChessBet accounts.",
      "Creating or using multiple accounts.",
      "Providing false information to commit identity fraud.",
      "Impersonating another player or person.",
    ],
  },
  {
    title: "Match Integrity",
    items: [
      "Match fixing.",
      "Intentionally losing a contest.",
      "Colluding with another player to influence a result.",
      "Participating in prize transfer schemes.",
      "Attempting to manipulate ratings.",
      "Creating artificial contest outcomes.",
    ],
  },
  {
    title: "Payment Abuse",
    items: [
      "Using stolen payment methods.",
      "Chargeback abuse.",
      "Payment fraud.",
      "Money laundering.",
      "Structuring transactions to avoid detection or reporting thresholds.",
      "Artificial movement of funds between accounts.",
    ],
  },
  {
    title: "Location Abuse",
    items: [
      "Using VPNs to misrepresent your location.",
      "Using proxy services to misrepresent your location.",
      "Using remote desktop software to circumvent location controls.",
      "GPS spoofing.",
      "Any other attempt to bypass geolocation controls.",
    ],
  },
];

export const MONITORING_SOURCES = [
  "Game records",
  "Server logs",
  "Move history",
  "Account history",
  "Device information",
  "Connection history",
  "Payment activity",
  "Geolocation information",
  "Contest history",
  "User reports",
  "Other relevant evidence available to ChessBet",
];

export const RISK_INDICATORS = [
  "Repeated contests between the same players",
  "Unusual resignation patterns",
  "Unusual timeout patterns",
  "Linked devices",
  "Linked payment methods",
  "Rapid funding and withdrawal activity",
  "Abnormal contest behavior",
  "Suspicious account relationships",
];

export const INVESTIGATION_ACTIONS = [
  "Temporarily delay Contest Settlement",
  "Temporarily delay withdrawals",
  "Request additional identity verification",
  "Review game history",
  "Review payment activity",
  "Review technical logs",
  "Review reports submitted by users",
];

export const ENFORCEMENT_ACTIONS = [
  "A warning",
  "Contest forfeiture",
  "Cancellation of contests",
  "Return of Entry Amounts where appropriate",
  "Withholding Contest Settlement pending investigation",
  "Temporary account suspension",
  "Permanent account termination",
  "Reporting to payment processors or law enforcement where legally required",
];

export const PRIVATE_CHALLENGE_REVIEW_ITEMS = [
  "Repeated contests",
  "Unusual outcomes",
  "Linked accounts",
  "Suspicious financial behavior",
];

export const REPORTING_ITEMS = [
  "Suspected cheating",
  "Suspicious behavior",
  "Collusion",
  "Bugs",
  "Payment abuse",
];