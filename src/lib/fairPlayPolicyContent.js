// Shared by the interactive policy page and the prerendered public page.
export const FAIR_PLAY_METADATA = {
  "title": "Chess Anti-Cheat & Fair Play — Human Review & Appeals | ChessBet",
  "description": "Learn what ChessBet prohibits, how matches are checked, and how to report a concern or request a review of a decision."
};
export const FAIR_PLAY_OVERVIEW = "Play your own moves. ChessBet uses server-verified game records, post-game checks, and player reports to investigate concerns.";
export const FAIR_PLAY_SUPPORT_EMAIL = "hello@worldchessbet.com";

export const FAIR_PLAY_SECTIONS = [
  {
    id: "4-prohibited-conduct",
    title: "What’s prohibited",
    items: [
      ["Outside help","Make every move yourself. Engines, AI, analysis tools, move-suggestion extensions, bots, macros, and live coaching are prohibited."],
      ["Match and rating manipulation","No match fixing, deliberate losses to manipulate results, collusion, rating manipulation, or using contests to transfer prizes."],
      ["Account abuse","Use one account of your own. Account sharing or sales, false identity information, and impersonation are prohibited."],
      ["Payment abuse","No stolen payment methods, fraudulent chargebacks, money laundering, artificial transfers, or transactions structured to evade detection or reporting."],
      ["Bypassing safeguards","Do not misrepresent your location or work around location checks, identity checks, or other platform safeguards. Do not exploit platform errors."],
    ],
  },
  {
    id: "how-cheating-is-caught",
    title: "How games are checked",
    items: [
      ["During play","ChessBet’s servers validate moves and record the board position, move history, clocks, and result. The same gameplay rules apply to public and private challenges."],
      ["After a money match","Stockfish screening may compare moves with engine choices and look at move quality, critical positions, timing, and focus changes. Screening depends on available game data and service availability."],
      ["After a free match","ChessBet runs behavioral checks and skips automatic Stockfish screening. Behavioral indicators can include repeated opponents, unusual resignations, and unusual timeouts."],
    ],
  },
  {
    id: "7-investigations",
    title: "What happens during a review",
    items: [
      ["Evidence and decisions","ChessBet may review game records, player reports, device and connection data, and relevant account, location, and payment activity. Flags can trigger review. A person evaluates the evidence before deciding whether a violation occurred."],
      ["While a case is open","Pending winnings can remain held past the standard 24-hour reporting window while a dispute or blocking integrity or settlement issue is unresolved. An investigation may also delay settlement or withdrawals, or require additional identity checks."],
      ["Possible outcomes","ChessBet may issue a warning, void or reverse a contest, suspend or close an account, or refer a case externally when appropriate. A flag alone never changes a result or imposes an account penalty."],
    ],
  },
  {
    id: "3-contest-fee-integrity",
    title: "How entries, fees, and prizes work",
    items: [
      ["Money matches","Each player’s Entry Amount and fixed Platform Service Fee are shown separately. The winner of a decisive contest earns the combined Entry Amounts. The fee is separate from the prize."],
      ["Refunds and reversals","A draw, accepted cancellation, or void returns the Entry Amount and fee actually reserved. If a review finds no violation, decisive-result fees stand. If a settled result is reversed, the reviewer records whether the fees are retained or refunded."],
    ],
  },
  {
    id: "11-reporting-fair-play-concerns",
    title: "How to report a concern",
    items: [
      ["Use Report Contest","Open Report Contest during or after a match, or from an eligible Wallet History transaction. Describe the concern and save your case number."],
      ["Reporting window","For a settled contest, report within 24 hours of settlement. If you report from Wallet History, follow the deadline shown for that transaction."],
      ["What reporting does","Your report opens a case for review. An open case can delay release of pending winnings. The report itself does not change the result or move funds."],
    ],
  },
  {
    id: "appeals",
    title: "How to request a review of a decision",
    items: [
      ["Appeal eligibility","A participant can appeal a resolved case with an adverse decision once per case."],
      ["Contact support","Email ChessBet Support with your case number, the decision you want reviewed, and any supporting details. This is also the contact if an account restriction prevents access."],
    ],
  },
];
