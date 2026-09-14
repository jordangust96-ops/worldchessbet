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
          "ChessBet offers head-to-head chess contests between the players themselves. A skill-based format does not establish legal availability everywhere. Paid features require verified age 21+, identity and location eligibility, and applicable account checks. See the current Official Rules for supported states and restrictions.",
        ],
      },
      {
        question: "How do I start playing?",
        list: [
          "Create an account and complete the required identity and location checks.",
          "Connect an eligible bank account and fund your wallet.",
          "Create and share a Challenge Someone link, or use Find an Opponent for the public marketplace. Creating a link does not require a funded wallet or reserve an opponent.",
          "For a shared challenge, both players need sufficient Available Balance. The creator enables acceptance, the recipient reviews and accepts the entry plus separate fee, and both players then confirm readiness.",
          "Complete the match.",
          "After a decisive settlement, winnings remain pending for the standard 24-hour reporting window. Automatic release follows when the deadline has passed and no open dispute or blocking integrity or settlement-reconciliation flag remains.",
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
          "Socure verifies player identity and age 21+ before paid activity. Connecting a bank through Seamless and Plaid is a separate bank-verification step. Location and account checks also apply.",
        ],
      },
      {
        question: "Why is identity verification required?",
        paragraphs: [
          "Identity verification helps assess age and identity eligibility and reduce fraud. A successful identity check does not by itself authorize funding, contest entry, or withdrawal.",
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
          "Deposits have a $10 wallet-credit minimum and a $1,100 total bank-debit maximum including the separate deposit fee. The Wallet shows wallet credit, deposit fee, and total debit before submission. Deposits become available to play after Seamless reports Processed and ChessBet completes the provider and settlement checks. Bank withdrawals require five business days from submission and a final provider check; prizes and refunds inherit remaining holds.",
        ],
      },
      {
        question: "Can I withdraw anytime?",
        paragraphs: [
          "When withdrawals are enabled and your account is eligible, you may request available funds through your verified bank. Requests are limited to $1,100 each and shared platform capacity of $1,100 per rolling 24 hours and $22,000 per rolling 31 days across all users.",
          "Pending deposits, Clearing funds, reserved contest funds, pending winnings, and existing withdrawal reservations are unavailable to withdraw. Requests below $10 have a separate $2.50 fee, waived for a withdrawal of your entire Available to Withdraw balance. Confirmed failed or reversed withdrawals return any associated charged withdrawal fee. Provider processing and reviews can delay arrival.",
        ],
      },
      {
        id: "how-payouts-work",
        question: "How do payouts work?",
        paragraphs: [
          "After a decisive result is confirmed, the winner receives 100% of both players' combined Contest Entry Amounts. The fixed Platform Service Fee is disclosed and reserved separately, so it is not deducted from the winner's prize.",
          "The prize includes the winner's own Entry Amount, so it is not net profit. Winnings remain pending during the standard 24-hour window from recorded settlement. Automatic release occurs after the deadline when no open dispute or blocking integrity or reconciliation flag remains. Review can delay release even without a player report.",
          "A draw, accepted cancellation, or platform void returns each player's reserved Entry Amount and Platform Service Fee to the wallet ledger. This does not refund separate deposit fees or automatically send money to a bank. A reversed decisive contest has different entry and fee treatment, as explained in the Official Rules.",
        ],
      },
    ],
  },
  {
    category: "Matches",
    items: [
      {
        question: "Can I challenge a friend or share a match link?",
        paragraphs: [
          "Yes. Use Challenge Someone to create a five-minute Blitz invitation and share its link. Ordinary links can be accepted by the first eligible, funded holder while the creator has enabled acceptance. A rematch link may be restricted to your previous opponent. Open links normally expire after 24 hours.",
          "The creator enables a two-minute acceptance window after confirming the terms and current eligibility. This reserves nothing. Successful final acceptance reserves both players’ entry amounts and separate fees together, then both players explicitly ready up before play starts.",
        ],
      },
      {
        question: "Does starting a deposit reserve a challenge for me?",
        paragraphs: [
          "No. Opening a link, signing up, verifying your account or starting a deposit does not claim a challenge. Pending and Clearing funds cannot be used to accept it. The link stays open, the creator may play elsewhere, and another eligible player may accept first.",
          "The wallet can remember the invitation you were viewing without reserving it. When your funds become available, revisit the link or create a new challenge. Deposits and pending winnings keep their existing clearance and release rules.",
        ],
      },
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
          "Participants may cancel a challenge during matching or preparation before its start transition begins. Any actually reserved Entry Amount and Platform Service Fee are returned.",
          "Ordinary cancellation is unavailable once the match starts its transition to live play. Stale preparation can be cancelled by the timeout process after the two-minute window. A technical complaint does not automatically cancel a live contest.",
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
          "Players can submit a contest report during the standard 24-hour window shown in transaction history. Contact Support for concerns outside that window.",
          "A participant in a resolved case with an adverse determination can submit one in-app appeal per case. The current flow does not impose a seven-day cutoff.",
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
          "Seamless handles bank transfers while ChessBet maintains the internal wallet ledger. Wallet balances are not personal bank accounts or a promise of independent escrow or FDIC insurance. Funding and withdrawals depend on verified identity, account status, provider confirmation, and applicable holds.",
        ],
      },
      {
        question: "Is my personal information secure?",
        paragraphs: [
          "ChessBet and its providers process account, identity, bank-verification, transaction, game, and review data. Retained Socure provider reports are encrypted before storage, and sensitive records have access controls.",
          "ChessBet retains verification evidence and operational records; it does not simply pass all personal information through without storing it. See the Privacy Policy for providers, retention, and cookie choices.",
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