// Public legal copy snapshot used only to make the initial HTML response crawlable.
// The interactive legal pages continue to load the active PrivacyPolicyConfig records.
// Keep this snapshot aligned with those records when legal copy changes.
export const PUBLIC_LEGAL_DOCUMENTS = {
  official_rules: {
    route: "/official-rules",
    label: "Official Rules",
    title: "Cash Chess Rules | Entries, Prizes & Fair Play — ChessBet",
    description: "Read ChessBet's Official Rules governing skill-based chess contests, entry amounts, match settlement, fair play standards, and eligibility requirements.",
    version: "6.0",
    lastUpdated: "September 13, 2026",
    supportEmail: "hello@worldchessbet.com",
    markdown: `## Contest Format
Each Contest is a head-to-head (1v1), real-money chess match conducted through ChessBet's server-authoritative game engine. The server validates move legality, enforces time controls, and detects game-ending conditions, and the server-maintained game state (FEN position and move log) is the sole authoritative record of gameplay.

## Player Eligibility
Real-money features require verified identity and age 21 or older, U.S. residency, and physical presence in a location supported by ChessBet. The current supported states are Arkansas, Colorado, Georgia, Iowa, Kansas, North Dakota, Texas, Virginia, Wisconsin, and Wyoming. This is ChessBet's access policy, not a representation of government approval or a legal determination for any state. Availability can change and remains subject to applicable law, account restrictions, and enabled payment and contest services. Each player may maintain only one Account.

Location checks use IP-based estimates and available device/browser location evidence at onboarding, funding, contest entry, and pre-match readiness. A home address or successful bank connection does not establish physical-location eligibility. Uncertain, conflicting, or unsupported location evidence can prevent access. Players must remain in a supported location during play; these checks are not a claim of continuous GPS monitoring.

## Challenge Preparation and Cancellation
Use Create Challenge to choose the offered Entry Amount and time control, or Join Challenge to accept another player's terms. Public and private challenges use the same eligibility and preparation checks. Creating or joining does not itself reserve funds. Before play begins, both players must complete readiness, fair-play certification, funding reservation, and fresh match-location checks.

Participants may cancel before the match begins its start transition. Stale preparation can be cancelled after the two-minute preparation window by the timeout process, returning any funds actually reserved. Once the start transition or live play has begun, ordinary cancellation is unavailable; game outcomes and administrative review govern instead.

## Contest Entry Amounts and Platform Service Fees
The challenge states the same Entry Amount for each player. Before reservation, ChessBet discloses the Entry Amount, fixed per-player Platform Service Fee, Total Reserve Amount (entry plus fee), and Contest Prize (both entries combined). The fee is separate from the entries and is never deducted from the Contest Prize. The fee schedule below covers supported amounts; the challenge interface determines which entry options are currently offered.

## Settlement of Contest Outcomes
A decisive result credits the winner with the full combined Entry Amounts as the Contest Prize and recognizes both players' separately reserved Platform Service Fees. The prize includes the winner's own Entry Amount; it is not the winner's net profit.

After a decisive result, the Contest Prize is credited to pending winnings. The standard reporting window is twenty-four (24) hours from the recorded settlement. Release is processed automatically after the deadline when no open dispute or blocking integrity or settlement-reconciliation flag remains. Processing may occur after the displayed deadline; a report is not the only reason funds can remain held.

A draw, accepted cancellation, or administrative void returns each player's Entry Amount and Platform Service Fee actually reserved. A connection problem or technical complaint does not automatically void a Contest; the server result and any subsequent review determine the treatment. Integrity-review reversals are described below.

## Determining a Winner
A Contest can end by checkmate, resignation, timeout, or a draw. The app automatically recognizes stalemate, threefold repetition, the fifty-move rule, and insufficient material through its chess engine; players can also agree to a draw.

For timeout decisions, ChessBet currently uses a material-count rule: the non-timed-out player has sufficient material if they have a pawn, rook, queen, or at least two bishops/knights in total. A lone king, or a king with only one bishop or knight, is treated as insufficient and the result is a draw. This simplified online rule is not a full position-by-position implementation of FIDE Article 6.9.

## Fair Play Screening, Integrity Review, and Appeals
Completed Contests can be queued for Stockfish-powered post-game screening and rule-based behavioral checks. Screening depends on service availability and sufficient game data; queuing is not a guarantee of completed analysis. Available indicators may include engine agreement, centipawn loss, critical-position performance, move timing, focus-loss events, repeated opponents, unusual resignations, and unusual timeouts.

Automated signals do not by themselves prove cheating, change a result, or impose an account penalty. Open blocking integrity or settlement-reconciliation flags can delay the automatic release of pending winnings while the matter is reviewed. A person considers the available game, technical, account, report, and dispute evidence before an enforcement decision.

An Integrity Review does not itself establish a violation. If no violation is found, the result and ordinary decisive-result fees stand. If a Contest is voided, both players' Entry Amounts and Platform Service Fees are returned. A reversal of a settled decisive result removes the original winner's Contest Prize, returns the original loser's Entry Amount, and leaves the remaining entry funds reserved for a separate disposition; it does not automatically award the full prize to the other player. On a reversal, the administrator records whether the separately charged Platform Service Fees are retained or refunded. Contest entry funds are not recorded as platform fee revenue.

A participant in a resolved case with an adverse determination may submit one in-app appeal per case and supporting information. The current in-app appeal flow does not impose a seven-day cutoff. Contact {{SUPPORT_EMAIL}} if account restrictions prevent access.

## Disputes
Players should report a Contest concern through the app within the standard twenty-four (24) hour reporting window shown in wallet history. ChessBet may review game records, server logs, automated screening records, integrity flags, player reports, dispute evidence, and other relevant information to resolve disputes. A timely report keeps affected funds held during review.

## Amendments
Updates apply prospectively. Historical Contests and authorizations retain their recorded terms; this revision does not retroactively change an existing user's settlement, refund, or appeal rights.

## Contact
Questions about these Official Rules can be sent to {{SUPPORT_EMAIL}}.`
  },
  terms_of_service: {
    route: "/terms-of-service",
    label: "Terms of Service",
    title: "ChessBet Terms | Eligibility, Fees & Dispute Rules",
    description: "Review ChessBet's Terms of Service outlining account eligibility, contest rules, platform fees, dispute resolution, and your rights as a registered player.",
    version: "6.0",
    lastUpdated: "September 13, 2026",
    supportEmail: "hello@worldchessbet.com",
    markdown: `## Acceptance of Terms
By creating an Account, accessing the Platform, or participating in a Contest, you agree to these Terms of Service, the Official Rules, and the Privacy Policy. The fair-play, identity-verification, and financial-integrity requirements described in these documents apply to use of the Platform.

## Account Registration and Identity Verification
You must register with accurate, complete, and current information. ChessBet requires identity verification before you may deposit funds, participate in Contests, or withdraw funds. You are responsible for maintaining the confidentiality of your Account credentials and for all activity that occurs under your Account.

## Platform Description
ChessBet offers head-to-head chess contests in which the participating players compete for their combined Entry Amounts. ChessBet does not offer wagers on third-party matches, casino games, or random prize games. Describing the product as a skill contest does not establish its legal classification or availability in a particular jurisdiction. Gameplay uses server-recorded moves, clocks, and results, subject to the correction and dispute procedures in the Official Rules.

## Deposits and Withdrawals
ChessBet uses SeamlessChex (Seamless) for bank authorization and payment processing, with Plaid inside Seamless's hosted bank-connection flow. Socure identity and age verification is separate from bank verification. Connecting a bank does not itself transfer money or complete player identity verification. Each transfer requires the applicable authorization, verified account, available service, and account checks.

Before a deposit is submitted, the Wallet shows the amount to be credited, the deposit fee, and the total bank debit. The deposit fee is separate from any Platform Service Fee. The current deposit minimum is $10 of wallet credit, and the total bank debit including the deposit fee cannot exceed $1,100. Provider submission does not make funds spendable: deposits can remain Pending, then Clearing, until their displayed clearance date and a successful final bank-status check. The clearance date is an estimate, not a guarantee against a later bank return.

A failed or returned bank deposit may remove previously credited funds. If the available or clearing funds do not cover the return, the account can be placed on hold with a balance due for review. Deposit-fee reconciliation and any related adjustment depend on the recorded transfer and provider settlement evidence; cancelling or drawing a Contest does not refund a separate deposit fee.

Withdrawals use the verified connected bank and are subject to identity verification, account holds, available balance, and provider status. Standard bank processing applies; an eligible faster transfer may be used only when supported and enabled. No instant arrival is guaranteed. Pending deposits, Clearing funds, Reserved Contest Funds, pending winnings, and funds already reserved for withdrawal are unavailable for another withdrawal.

The current withdrawal maximum is $1,100 per request. Shared platform transfer capacity also limits aggregate payouts to $1,100 in a rolling 24-hour window and $22,000 in a rolling 31-day window, across all users. A request can be temporarily unavailable even when the user has sufficient Available Balance. A withdrawal below $10 has a separate $2.50 fee, waived when withdrawing the entire Available Balance. The fee is charged after the provider accepts the request; a confirmed failed or reversed withdrawal returns its associated charged withdrawal fee. An unknown provider outcome stays pending for reconciliation.

Contest refunds return to the ChessBet ledger balance; they are not automatic transfers to a bank. A bank withdrawal is a separate request.

## Taxes
Contest proceeds may create tax obligations. You are responsible for keeping records and obtaining advice about your own reporting obligations. Wallet history is not a tax return or tax advice. ChessBet does not promise automatic tax withholding or a particular tax form; the absence of a form does not determine whether income is reportable.

## Prohibited Conduct
You may not enter or play paid Contests outside a supported location, circumvent geolocation or identity-verification controls, use a chess engine, AI tool, or other outside assistance during a Contest, collude or manipulate Contest outcomes, or exploit bugs or errors for competitive advantage. Contact Support for help with existing funds if you are no longer eligible for paid play.

## Account Suspension, Restrictions, and Closure
ChessBet may suspend, restrict, or close an Account, or hold funds, for suspected fraud, prohibited conduct, unresolved verification, bank returns, or legal or processor requirements. Holds and case remedies follow the recorded review and settlement process; a restriction does not convert Contest Entry Amounts into platform revenue.

Account closure does not erase financial or compliance records, cancel a live game's clock, or accelerate pending funds. Remaining funds can require settlement, verification, review, or one or more supported bank transfers before they can be returned. Contact {{SUPPORT_EMAIL}} for help accessing existing funds when self-service access is restricted.

## Disclaimer of Warranties and Limitation of Liability
The Platform is provided "as is" and "as available" to the extent permitted by applicable law. ChessBet does not guarantee uninterrupted service, detection of every violation, a particular Contest outcome, or a financial result. Nothing in these Terms excludes rights or liability that applicable law does not permit to be excluded.

## Changes to These Terms
Updates apply prospectively through the Platform's policy-acceptance process. This revision describes the current build and does not retroactively change recorded Contest terms, transfer authorizations, or existing rights.

## Contact
Questions about these Terms of Service can be sent to {{SUPPORT_EMAIL}}.`
  },
  privacy_policy: {
    route: "/privacy-policy",
    label: "Privacy Policy",
    title: "ChessBet Privacy | Identity, Payment & Account Data",
    description: "Learn how ChessBet collects, uses, and protects your personal data, including identity verification, payment details, and account activity information.",
    version: "4.0",
    lastUpdated: "September 13, 2026",
    supportEmail: "hello@worldchessbet.com",
    markdown: `## Information We Collect
We collect account and contact information you provide, including your name, email, username, and support communications. Authentication is handled through Base44. Socure handles the hosted identity and age-verification process, which may collect identity details, date of birth, government-ID images, and related verification evidence as required by that flow. ChessBet receives verification decisions, verified name and age indicators, provider references, and retained provider-report evidence.

SeamlessChex (Seamless) and its hosted Plaid flow handle bank connection. The current bank-connection flow does not ask you to enter bank-login credentials or complete bank account numbers into ChessBet. ChessBet retains provider references, bank-verification status and available bank metadata, ACH authorization text and signer information, and payment/transaction records. Bank verification is separate from Socure player identity verification.

## Information Collected Automatically
We collect device and technical information, account activity, session/security records, IP-based geolocation and risk information through MaxMind, and browser/device location evidence when provided or permitted. Location evidence is used to assess access and detect mismatches; it is an estimate and can be inconclusive. Gameplay records include moves, clock/timing data, focus-loss events, and operational telemetry. Essential browser storage supports the service. Optional public-page analytics and advertising measurement are collected only when enabled through Cookie settings; Global Privacy Control keeps optional tracking off.

## How We Use Information
We use information to create and secure accounts; verify identity, age, bank authorization, and location eligibility; process and reconcile transfers; facilitate and settle Contests; identify potential fraud or prohibited conduct; review disputes and appeals; provide support and permitted communications; and meet applicable legal and processor requirements.

## Data Storage and Security
ChessBet retains account, transaction, game, and review records in its application data store. Retained Socure provider-report evidence is encrypted before storage. Access controls restrict sensitive verification, financial, and administrative records. Infrastructure services also process data needed for their functions. No storage or transmission method is completely secure.

## Cookies and Similar Technologies
Essential cookies and browser storage support authentication, MFA, security, requested game features, and remembering your privacy choice. Rejecting optional cookies does not prevent account access or gameplay.

Optional tracking is off until you choose it. Select Reject optional, Accept optional, or Manage preferences. Cookie settings are available in the public-page footer and your profile. Your choice applies to this browser, carries across login and navigation, and is remembered for 180 days. You can withdraw or change it at any time. Clearing browser storage or using another browser may require a new choice. If your browser prevents storage, optional tracking remains restricted and choices may not persist.

Analytics: With permission, Google Analytics measures eligible public-page visits using cookies such as _ga and _ga_JLHMN26FS2, configured to last up to 180 days. Advertising: With separate permission, Meta measures visits to eligible public pages without URL parameters; its _fbp cookie typically lasts 90 days. These providers receive technical information such as IP address and browser information when contacted. Browser settings can further limit cookies.

Optional Google and Meta tracking is not enabled on signed-in, login, registration, MFA, wallet, identity, or admin pages. We do not send identity-verification events, account identifiers, or contest amounts/results to Meta. Tracking is also suppressed on pages containing URL query parameters or fragments.

Global Privacy Control keeps both optional categories off even if an earlier choice enabled them. Withdrawing consent stops future optional collection and removes accessible optional tracking cookies; it does not automatically erase data already received by a provider. Contact us to exercise applicable data rights.

Base44 session recording and HeyCatch browser tracking are disabled as of September 12, 2026. Essential hosting, operational, fraud-prevention, and security records continue. Cookie lifetimes and the duration of browser storage are distinct from providers' server-side retention periods.

Hosted identity and bank-authorization services have their own privacy notices. Review those notices when using their services.

## Children's Privacy
Real-money features require verified age 21 or older under ChessBet's current platform policy. The service is not directed to children. Contact {{SUPPORT_EMAIL}} if you believe a child has provided personal information so we can review the account and applicable obligations.

## Your Rights
Depending on your jurisdiction, you may have the right to request access to, correction of, or deletion of your personal information, or to withdraw consent to certain processing activities, subject to applicable legal and regulatory retention requirements.

## Changes to This Policy
We may update this Privacy Policy periodically to reflect changes in our practices, services, or legal obligations. Material changes will be communicated through the Platform, and the "Last Updated" date will reflect the most recent revision.

## Contact
Questions about this Privacy Policy can be sent to {{SUPPORT_EMAIL}}.`
  }
};
