const topics = {
  "Contest Format": [
    ["Match format"],
    ["Game record","The server validates"],
  ],
  "Player Eligibility": [
    ["Who can play"],
    ["Supported states","The current supported states"],
    ["Account limit","Each player may maintain"],
    ["Location checks","Location checks use"],
    ["Location evidence","A home address"],
    ["During play","Players must remain"],
  ],
  "Challenge Preparation and Cancellation": [
    ["Create a money challenge"],
    ["Free challenges","Free challenges require"],
    ["Claiming a challenge","The first eligible"],
    ["Entry and fee reservation","Acceptance reserves"],
    ["Ready to play","Each player completes"],
    ["Deadlines","An unclaimed challenge"],
    ["Acceptance notifications","The creator receives"],
    ["Cancellation and refunds","Participants may cancel"],
    ["Interrupted requests","An interrupted request"],
    ["After the start transition","Once the start transition"],
    ["Which challenges these rules cover","These creation rules"],
  ],
  "Contest Entry Amounts and Platform Service Fees": [
    ["Entry and reserve amount"],
    ["Prize and service fee","The fee is separate"],
  ],
  "Settlement of Contest Outcomes": [
    ["Decisive result"],
    ["Pending winnings","After a decisive result"],
    ["Release conditions","Release is processed"],
    ["Refunds","A draw, accepted cancellation"],
    ["Technical issues","A connection problem"],
  ],
  "Deposit Availability and Withdrawal Processing": [
    ["Deposit costs"],
    ["When deposits become playable","Settled deposits become available"],
    ["Request a withdrawal","Players can request"],
    ["When payment is sent","The backend submits"],
    ["Withdrawal fees","Standard withdrawals"],
    ["Holds carry forward","When a contest uses"],
    ["Mixed funding","Mixed-funded prizes"],
    ["Independent reviews","The existing twenty-four-hour"],
  ],
  "Determining a Winner": [
    ["How a contest ends"],
    ["Draws","The app automatically"],
    ["Timeout rule","For timeout decisions"],
    ["Insufficient material","A lone king"],
  ],
  "Disconnections and Technical Issues": [
    ["What a missed heartbeat means"],
    ["Reconnect windows","A reconnect window starts"],
    ["What happens when time runs out","If that player's clock"],
    ["Thinking time","A connected player"],
    ["Clock and reports","The reconnect window does not pause"],
  ],
  "Fair Play Screening, Integrity Review, and Appeals": [
    ["Post-game screening"],
    ["Signals reviewed","Available indicators"],
    ["Human review","Automated signals"],
    ["If no violation is found","An Integrity Review"],
    ["Voids and reversals","If a Contest is voided"],
    ["Fees after a reversal","On a reversal"],
    ["Appeals","A participant in a resolved case"],
  ],
  "Disputes": [
    ["How to report"],
    ["What ChessBet reviews","ChessBet may review"],
    ["Funds on hold","A timely report"],
  ],
  "Amendments": [
    ["When updates apply"],
  ],
  "Apple Disclosure": [
    ["Sponsorship"],
    ["Who to contact","Questions about contests"],
  ],
};
const copyEdits = [
  [
    "The deposit fee helps ChessBet cover secure bank processing, verification, and standard transfer services through trusted payment providers.",
    "The deposit fee helps cover bank processing, verification, and standard transfer services."
  ],
  [
    "Both players must return and confirm readiness before that deadline; being offline does not prevent acceptance.",
    "Both players must return and confirm readiness before that deadline."
  ],
  [
    "Report a technical concern through the in-app process; a report does not itself change the result.",
    "Report technical concerns in the app."
  ],
  [
    "Integrity-review reversals are described below.",
    ""
  ]
];

// Split the active policy text at known topic boundaries. Fall back to the
// original Markdown when a new policy version changes those boundaries.
export function getOfficialRulesBullets(title, markdown) {
  if (!Object.hasOwn(topics, title)) return null;
  if (/^\s*(?:[-*+] |\d+\. |#)/m.test(markdown)) return null;

  const boundaries = topics[title];
  const starts = [0];
  for (const [, anchor] of boundaries.slice(1)) {
    const index = markdown.indexOf(anchor, starts.at(-1) + 1);
    if (index < 0) return null;
    starts.push(index);
  }

  return boundaries.map(([label], index) => {
    let text = markdown.slice(starts[index], starts[index + 1]).trim();
    for (const [original, replacement] of copyEdits) {
      text = text.replace(original, replacement).trim();
    }
    return { label, text };
  });
}
