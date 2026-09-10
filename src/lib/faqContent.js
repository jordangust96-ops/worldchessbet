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
          "Create an account and complete the required identity and location checks.",
          "Connect an eligible bank account and fund your wallet.",
          "Host a challenge or accept one from another player.",
          "Complete the match.",
          "After a decisive result, winnings remain pending during the standard 24-hour reporting window. If no report is filed, they become available automatically.",
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
          "ChessBet verifies player identity and eligibility before allowing participation in real-money contests.",
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
          "ChessBet supports ACH bank transfers through a connected bank account for eligible, verified users.",
          "Additional payment methods may be introduced over time.",
        ],
      },
      {
        question: "Can I withdraw anytime?",
        paragraphs: [
          "You may request a withdrawal of available funds at any time.",
          "Pending deposits, ACH funds that are still clearing, reserved contest funds, and winnings in the 24-hour reporting window are not yet available to withdraw. Withdrawals also remain subject to identity verification, fraud-prevention review, and confirmed payment-provider status.",
        ],
      },
      {
        id: "how-payouts-work",
        question: "How do payouts work?",
        paragraphs: [
          "After a decisive result is confirmed, the winner receives 100% of both players' combined Contest Entry Amounts. The fixed Platform Service Fee is disclosed and reserved separately, so it is not deducted from the winner's prize.",
          "Winnings remain pending during the standard 24-hour reporting window. If no report is filed, they become available automatically. If a report triggers an integrity review, the affected funds remain held until a person reviews the available evidence and resolves the contest.",
          "For a draw, cancellation, or platform void, each player's Contest Entry Amount and Platform Service Fee are returned. Available funds may be withdrawn through the supported bank-transfer method, subject to identity verification, fraud-prevention review, active-contest holds, and confirmed provider status.",
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
        question: "How are wallet funds handled?",
        paragraphs: [
          "ChessBet uses Seamless for bank authorization and payment processing while ChessBet maintains the application ledger. Funding and withdrawals remain subject to provider status, identity verification, and fraud-prevention review.",
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