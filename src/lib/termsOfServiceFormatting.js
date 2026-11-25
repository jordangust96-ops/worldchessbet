import { getLegalSectionBullets } from "./legalSectionFormatting.js";

const topics = {
  "Acceptance of Terms": [
    ["Agreement"],
    ["Platform requirements","The fair-play, identity-verification"],
  ],
  "Eligibility": [
    ["Who can play for money"],
    ["Supported states","The current supported states"],
    ["One account","Each player"],
    ["Location checks","Location checks use"],
    ["Physical presence","A home address"],
  ],
  "Account Registration and Identity Verification": [
    ["Registration"],
    ["Identity checks","ChessBet requires identity verification"],
    ["Account security","You are responsible"],
  ],
  "Platform Description": [
    ["How ChessBet works"],
    ["Product scope","ChessBet does not offer"],
    ["Game record","Gameplay uses"],
  ],
  "Contests, Entry Amounts, and Platform Service Fees": [
    ["Creating a challenge"],
    ["Accepting a challenge","The first eligible"],
    ["Ready to play","Each player completes"],
    ["Timing","An unclaimed challenge"],
    ["Cancellation and refunds","Participants may cancel"],
    ["Interrupted requests","An interrupted request"],
    ["New and existing challenges","These creation rules"],
    ["Prize and fees","The Contest Prize is the two"],
    ["Pending winnings","After a decisive result"],
  ],
  "Deposits and Withdrawals": [
    ["Verification and providers"],
    ["Deposit quote and limits","Before a deposit is submitted"],
    ["When deposits become playable","Settled deposits become available"],
    ["How to request a withdrawal","Players can request a withdrawal"],
    ["When payments can be sent","The backend submits payment"],
    ["Returned deposits","A failed or returned bank deposit"],
    ["Withdrawal eligibility","Withdrawals use the verified"],
    ["Withdrawal limits and processing","The current withdrawal maximum"],
    ["Withdrawal fee","Standard withdrawals of $10 or more"],
    ["Contest refunds","Contest refunds return"],
    ["Holds on winnings and refunds","When a contest uses funds"],
  ],
  "Wallet and Funds Flow": [
    ["Wallet balances"],
    ["What the wallet represents","The app does not provide"],
  ],
  "Taxes": [
    ["Your tax responsibilities"],
    ["Wallet records and forms","Wallet history"],
  ],
  "Prohibited Conduct": [
    ["What you must avoid"],
    ["Access to existing funds","Contact Support"],
  ],
  "Disconnections and Game Results": [
    ["Connection interruptions"],
    ["Reconnect countdown","A reconnect window starts"],
    ["Technical reports","A technical report"],
  ],
  "Fair Play, Anti-Cheating, and Integrity Review": [
    ["Post-game screening"],
    ["Human review and holds","Automated signals"],
    ["Review without a violation","An Integrity Review"],
    ["Voids and reversals","If a Contest is voided"],
    ["Appeals","A participant in a resolved case"],
  ],
  "Account Suspension, Restrictions, and Closure": [
    ["When ChessBet can restrict an account"],
    ["Closure and remaining funds","Account closure does not erase"],
  ],
  "Dispute Handling": [
    ["Contest disputes"],
    ["Other account or platform disputes","For other Account"],
  ],
  "Disclaimer of Warranties and Limitation of Liability": [
    ["Service availability"],
    ["Rights under applicable law","Nothing in these Terms"],
  ],
  "Governing Law and Dispute Resolution": [
    ["Governing law"],
    ["Arbitration and opt-out","Disputes are resolved"],
  ],
  "Changes to These Terms": [
    ["When changes apply"],
  ],
};

export function getTermsOfServiceBullets(title, markdown) {
  return getLegalSectionBullets(markdown, Object.hasOwn(topics, title) ? topics[title] : null);
}
