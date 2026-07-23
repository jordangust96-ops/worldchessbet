// Single source of truth for FAQ content — used by both the public /faq page
// and the FAQPage JSON-LD structured data, so there is only one version to maintain.
export const FAQ_SECTIONS = [
  {
    category: "General",
    items: [
      {
        question: "What is ChessBet?",
        paragraphs: [
          "ChessBet is a skill-based competition platform where players compete in head-to-head chess matches under agreed contest terms.",
        ],
      },
      {
        question: "Is ChessBet legal?",
        paragraphs: [
          "ChessBet is designed as a skill-based competition platform rather than a game of chance. Availability depends on applicable laws and user eligibility.",
        ],
      },
      {
        question: "How do I start playing?",
        list: [
          "Create an account.",
          "Host a challenge or accept one from another player.",
          "Complete the match.",
          "Contest results are automatically settled when the game ends.",
        ],
      },
    ],
  },
  {
    category: "Accounts",
    items: [
      {
        question: "How are players verified?",
        paragraphs: [
          "Prior to public launch, ChessBet will verify player identity and eligibility before allowing participation in real-money contests.",
          "During Early Access, these verification requirements are temporarily disabled.",
        ],
      },
      {
        question: "Why is identity verification required?",
        paragraphs: [
          "Identity verification helps prevent fraud, protects players, and supports compliance with financial and gaming regulations.",
        ],
      },
      {
        question: "Can I have multiple accounts?",
        paragraphs: ["No.", "Each player may maintain only one account."],
      },
    ],
  },
  {
    category: "Wallet",
    items: [
      {
        question: "What payment methods are accepted?",
        paragraphs: [
          "At launch, ChessBet intends to support secure ACH bank transfers.",
          "Additional payment methods may be introduced over time.",
        ],
      },
      {
        question: "Can I withdraw anytime?",
        paragraphs: [
          "Yes.",
          "Withdrawals may be requested at any time, subject to verification, fraud prevention, and any contests currently in progress.",
        ],
      },
      {
        question: "How do payouts work?",
        paragraphs: [
          "Each player contributes the agreed contest entry amount.",
          "The winner receives the full combined contest prize.",
          "ChessBet separately charges a transparent platform service fee that is shown before every contest begins.",
        ],
      },
    ],
  },
  {
    category: "Matches",
    items: [
      {
        question: "How are matches protected?",
        list: [
          "Every move is validated by the server.",
          "Match clocks are synchronized.",
          "Contest funds are reserved before play begins.",
          "Completed contests generate permanent settlement records.",
        ],
      },
      {
        question: "What happens if a player disconnects?",
        paragraphs: [
          "The match remains active.",
          "The game clock continues running according to the Official Rules.",
          "If time expires before the player reconnects, the contest is resolved according to the official rules and game state.",
        ],
      },
      {
        question: "Can I cancel a match?",
        paragraphs: [
          "Hosted challenges may be cancelled before another player accepts.",
          "Once both players commit to the contest, it cannot be cancelled except as provided in the Official Rules.",
        ],
      },
    ],
  },
  {
    category: "Fair Play",
    items: [
      {
        question: "How is cheating prevented?",
        paragraphs: [
          "ChessBet uses multiple integrity controls to protect competitive play.",
          "Additional monitoring and fair-play systems will continue to be introduced over time.",
        ],
      },
      {
        question: "What if I think someone cheated?",
        paragraphs: [
          "Players may report suspicious activity after a contest.",
          "Reports are reviewed according to ChessBet's integrity procedures.",
        ],
      },
    ],
  },
  {
    category: "Security",
    items: [
      {
        question: "Is my money safe?",
        paragraphs: [
          "At launch, customer funds are intended to be held by regulated banking partners while ChessBet maintains the application ledger.",
        ],
      },
      {
        question: "Is my personal information secure?",
        paragraphs: [
          "Sensitive information is handled through trusted third-party providers using industry-standard security practices.",
          "ChessBet minimizes the amount of personal information it stores directly.",
        ],
      },
    ],
  },
];

// Flattened list, used to build the FAQPage JSON-LD mainEntity array.
export function getFaqJsonLdEntities() {
  return FAQ_SECTIONS.flatMap((section) =>
    section.items.map((item) => {
      const text = item.list
        ? item.list.join(" ")
        : item.paragraphs.join(" ");
      return {
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text,
        },
      };
    })
  );
}