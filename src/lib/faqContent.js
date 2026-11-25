// Shared by the FAQ page, public HTML, and FAQ structured data.
export const FAQ_SECTIONS = [
  {
    "category": "Getting started",
    "items": [
      {
        "question": "What is ChessBet?",
        "paragraphs": [
          "Play head-to-head blitz, rapid, or classical chess for free or, if eligible, for real USD. In a decisive money match, the winner receives both players’ combined Entry Amounts."
        ]
      },
      {
        "question": "Where can I play for money?",
        "paragraphs": [
          "Paid play requires verified identity, age 21 or older, U.S. residency, physical presence in a supported state, a verified bank account, and enough playable funds for the entry and fee. See the Official Rules for supported states. Free play is available worldwide."
        ]
      },
      {
        "question": "How do I start playing?",
        "list": [
          "For free play, create an account, then create a free challenge or find an open free match.",
          "For money play, open Wallet and complete location and identity checks, connect a verified bank, and add funds. You can enter once those funds are available for play."
        ]
      },
      {
        "question": "How does verification work?",
        "paragraphs": [
          "Wallet setup checks your location before Socure verifies your identity and age. Seamless uses Plaid to verify your bank separately. Deposits use your saved wallet location approval. Paid match creation, acceptance, and readiness check your current location."
        ]
      },
      {
        "question": "Can I have multiple accounts?",
        "paragraphs": [
          "Each player may maintain one account."
        ]
      }
    ]
  },
  {
    "category": "Matches",
    "items": [
      {
        "question": "How do I challenge a friend or find an opponent?",
        "list": [
          "Use Challenge Someone to choose Blitz (3+0), Rapid (10+0), or Classical (15+0) and create a link. Turn on Show in Find an Opponent to list it publicly.",
          "For money challenges, ChessBet reserves the creator’s entry and separate fee when the link is confirmed. The first eligible recipient with enough playable funds can accept even if the creator is offline. Acceptance reserves the recipient’s entry and fee.",
          "An unclaimed ordinary challenge normally expires after 24 hours. After acceptance, both players have five minutes to return, attest to fair play, and confirm readiness. A rematch link may be limited to the previous opponent."
        ]
      },
      {
        "question": "Does starting a deposit reserve a challenge?",
        "paragraphs": [
          "Opening a link or starting a deposit does not claim a challenge. Pending and clearing funds cannot be used to accept. Another eligible player may accept first."
        ]
      },
      {
        "question": "Can I cancel a challenge?",
        "paragraphs": [
          "Either participant can cancel before the match starts its transition to live play. Cancellation, expiry, or a missed start window releases the entry amounts and fees actually reserved."
        ]
      },
      {
        "question": "What happens if a player disconnects?",
        "list": [
          "The reconnect countdown starts when ChessBet detects the disconnect, even on the other player’s turn. The chess clock keeps running.",
          "The displayed countdown is 38 seconds for 3+0, 68 for 10+0, and 98 for 15+0, including the final connection check.",
          "If a chess clock expires first, the normal clock-timeout rule applies. If the reconnect countdown expires first, ChessBet checks that the player is still offline and the opponent is connected before awarding a disconnect win."
        ]
      }
    ]
  },
  {
    "category": "Wallet and winnings",
    "items": [
      {
        "question": "How do deposits work?",
        "list": [
          "ChessBet supports ACH from your verified bank. Wallet shows the credit, separate deposit fee, and total bank debit before you submit.",
          "The minimum wallet credit is $10. The maximum bank debit is $1,100 including the deposit fee.",
          "Funds become playable after Seamless reports Processed and ChessBet completes its provider and settlement checks."
        ]
      },
      {
        "question": "What fees does ChessBet charge?",
        "list": [
          "Deposits have a processing fee shown in Wallet before you submit.",
          "Money matches have a fixed Platform Service Fee disclosed separately from the Entry Amount.",
          "Withdrawals below $10 carry a flat $2.50 fee unless you withdraw your entire Available Balance. Withdrawals of $10 or more have no separate fee. ChessBet charges the fee separately from your requested payout after Seamless accepts the withdrawal."
        ]
      },
      {
        "question": "When can I withdraw?",
        "list": [
          "Request up to $1,100 per withdrawal from Available Balance through your verified bank. Wallet reserves the requested amount and any fee and emails an estimated arrival date.",
          "Deposit-funded withdrawals cannot be sent before five banking business days from the original deposit. Bank, account, funding-source, and transfer-capacity checks can affect timing.",
          "Pending deposits, clearing funds, contest reserves, pending winnings, and existing withdrawal reservations cannot be withdrawn. Any fee already charged is refunded if the withdrawal is confirmed failed or reversed."
        ]
      },
      {
        "id": "how-payouts-work",
        "question": "How do payouts work?",
        "list": [
          "The winner of a decisive money match receives both entries, including their own. The separate Platform Service Fee is never deducted from the prize.",
          "Winnings stay pending for at least 24 hours after settlement. Open disputes and blocking integrity or settlement flags can delay release. Deposit withdrawal holds can still apply after winnings are released.",
          "Draws, accepted cancellations, and voids return reserved entries and contest fees to Wallet. The Official Rules explain how reversals are handled."
        ]
      }
    ]
  },
  {
    "category": "Fair play and support",
    "items": [
      {
        "question": "How are matches checked?",
        "paragraphs": [
          "ChessBet’s servers verify moves, clocks, and results. Money matches may receive post-game Stockfish screening and behavioral checks. Free games receive behavioral checks and skip automatic Stockfish screening. A person reviews the evidence before deciding whether a violation occurred."
        ]
      },
      {
        "question": "How do I report a concern or appeal a decision?",
        "list": [
          "You can use Report Contest during a match. From a settled match, use Report Contest within 24 hours of recorded settlement. From Wallet History, follow the deadline shown for that transaction.",
          "A participant can appeal a resolved case with an adverse decision once per case. Email ChessBet Support with your case number, the decision you want reviewed, and any supporting details."
        ]
      },
      {
        "question": "How are my wallet and personal information handled?",
        "paragraphs": [
          "Seamless processes bank transfers. ChessBet keeps an internal wallet ledger rather than a personal bank account. Retained Socure reports are encrypted, and access controls protect sensitive records. See the Privacy Policy for how information is used, retained, and shared."
        ]
      }
    ]
  }
];

export function getFaqJsonLdEntities() {
  return FAQ_SECTIONS.flatMap(({ items }) => items.map(({ question, list, paragraphs }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: (list || paragraphs).join(" ") },
  })));
}
