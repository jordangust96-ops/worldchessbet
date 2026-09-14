// Public legal copy snapshot used only to make the initial HTML response crawlable.
// The interactive legal pages continue to load the active PrivacyPolicyConfig records.
// Keep this snapshot aligned with those records when legal copy changes.
export const PUBLIC_LEGAL_DOCUMENTS = {
  official_rules: {
    route: "/official-rules",
    label: "Official Rules",
    title: "Cash Chess Rules | Entries, Prizes & Fair Play — ChessBet",
    description: "Read ChessBet's Official Rules governing skill-based chess contests, entry amounts, match settlement, fair play standards, and eligibility requirements.",
    version: "5.0",
    lastUpdated: "September 9, 2026",
    supportEmail: "hello@worldchessbet.com",
    markdown: `## Contest Format
Each Contest is a head-to-head (1v1), real-money chess match conducted through ChessBet's server-authoritative game engine. The server validates move legality, enforces time controls, and detects game-ending conditions, and the server-maintained game state (FEN position and move log) is the sole authoritative record of gameplay.

## Contest Entry Amounts and Platform Service Fees
Each participant selects a Contest Entry Amount from the published Preset Entry Tiers. Before entry, ChessBet discloses the Contest Entry Amount, the applicable Platform Service Fee, and the Total Reserve Amount (Contest Entry Amount plus Platform Service Fee) that will be reserved from your Account Balance as Reserved Contest Funds. The Platform Service Fee is a fixed-dollar, per-player charge, separate from the Contest Entry Amount, and is never deducted from the Contest Pool.

## Platform Service Fee Schedule
Contest Entry Amount $5.00–$10.00: $1.00 per player. $10.01–$25.00: $2.00. $25.01–$50.00: $4.00. $50.01–$100.00: $6.00. $100.01–$250.00: $10.00. $250.01–$500.00: $15.00. $500.01–$1,000.00: $20.00. $1,000.01–$2,500.00: $30.00. $2,500.01–$5,000.00: $40.00.

## Settlement of Contest Outcomes
Decisive Result (checkmate, resignation, or timeout resulting in a winner): the winner receives 100% of the Contest Pool. Both players' Platform Service Fees are earned by ChessBet. The winnings remain pending during the standard twenty-four (24) hour reporting window and become available automatically if no report is filed. If a report is filed, the affected funds remain held pending review and resolution.

Draw (stalemate, threefold repetition, fifty-move rule, insufficient material, mutual agreement, or timeout with insufficient mating material): both players' Contest Entry Amounts and Platform Service Fees are returned, and no fee is assessed. Void, Cancellation, or Technical Failure: both players' Contest Entry Amounts and Platform Service Fees are returned, and no fee is assessed. Integrity Review: affected Contest funds are held pending the outcome of the review.

## Determining a Winner
A Contest is decided by checkmate, resignation, or timeout. Consistent with FIDE Article 6.9, a player who is timed out while their opponent has insufficient material to deliver checkmate does not lose outright — the Contest is instead recorded as a draw. Draws also result from stalemate, threefold repetition, the fifty-move rule, or mutual agreement.

## Disconnections and Technical Issues
If a player disconnects, their clock continues to run and no separate grace period is applied. A player who fails to reconnect before their clock expires forfeits the Contest by timeout, subject to the insufficient-material exception above.

## Fair Play Screening, Integrity Review, and Appeals
All Contests are subject to ChessBet's fair-play standards. Live gameplay uses server-authoritative move validation, game-state recording, result determination, and chess-clock enforcement.

ChessBet queues completed Contests for Stockfish-powered post-game screening. Depending on the available game data, screening may evaluate engine move agreement, centipawn loss, critical-position performance, per-move timing, and focus-loss events. Separate rule-based checks may flag repeated opponent pairings, unusual resignations, or unusual timeouts. Player reports and dispute evidence may also initiate or support review.

Automated screening results and rule-based flags are indicators for confidential human review. They do not, standing alone, establish a violation or impose an automatic Account, financial, settlement, or enforcement action. ChessBet evaluates available game records, technical records, reports, dispute evidence, Contest history, and other relevant evidence before making a fair-play determination.

Suspected cheating, collusion, or other prohibited conduct may trigger an Integrity Review, during which affected Contest funds are held. ChessBet does not retain any Contest Entry Amount or Platform Service Fee as revenue from a Contest resolved through Integrity Review. Users may appeal an Integrity Review disposition within seven (7) calendar days of notification.

## Disputes
Players should report a Contest concern through the app within the standard twenty-four (24) hour reporting window shown in wallet history. ChessBet may review game records, server logs, automated screening records, integrity flags, player reports, dispute evidence, and other relevant information to resolve disputes. A timely report keeps affected funds held during review.

## Amendments
These Official Rules may be updated periodically to reflect new features or Contest formats. Amendments apply prospectively and do not alter the outcome or settlement of previously completed Contests.

## Contact
Questions about these Official Rules can be sent to {{SUPPORT_EMAIL}}.`
  },
  terms_of_service: {
    route: "/terms-of-service",
    label: "Terms of Service",
    title: "ChessBet Terms | Eligibility, Fees & Dispute Rules",
    description: "Review ChessBet's Terms of Service outlining account eligibility, contest rules, platform fees, dispute resolution, and your rights as a registered player.",
    version: "5.0",
    lastUpdated: "September 9, 2026",
    supportEmail: "hello@worldchessbet.com",
    markdown: `## Acceptance of Terms
By creating an Account, accessing the Platform, or participating in any Contest, you agree to be bound by these Terms of Service, the Official Rules, the Privacy Policy, and ChessBet's AML/KYC and Financial Integrity Program.

## Eligibility
You must be at least 18 years of age (or such higher age as required by your jurisdiction), a legal resident of the United States, and physically located in an Approved Jurisdiction to use real-money features of the Platform. Each user may maintain only one Account.

## Account Registration and Identity Verification
You must register with accurate, complete, and current information. ChessBet requires identity verification before you may deposit funds, participate in Contests, or withdraw funds. You are responsible for maintaining the confidentiality of your Account credentials and for all activity that occurs under your Account.

## Platform Description
ChessBet is a real-money, peer-to-peer, skill-based chess competition platform. ChessBet does not offer, facilitate, or promote gambling, casino games, or games of chance. All gameplay is processed through ChessBet's server-authoritative game engine, whose recorded game state is the sole authoritative record of any Contest outcome.

## Contests, Entry Amounts, and Platform Service Fees
Upon Contest entry, the Total Reserve Amount — your Contest Entry Amount plus the applicable Platform Service Fee — is reserved from your Available Balance as Reserved Contest Funds. The Platform Service Fee is a separate, fixed-dollar, per-player charge disclosed before entry. It is never deducted from the Contest Pool, and it is earned by ChessBet only on a decisive outcome. On a draw, void, or cancellation, both the Contest Entry Amount and the Platform Service Fee are returned.

After a decisive result, the winner's Contest winnings remain pending during the standard twenty-four (24) hour reporting window. If no report is filed, the winnings become available automatically. If a report is filed, the affected funds may remain held until review and resolution.

## Deposits and Withdrawals
Deposits and withdrawals are processed by ACH through ChessBet's payment processor and are subject to identity verification, fraud prevention, compliance review, and confirmed provider status. A deposit may first appear as Pending while the payment provider confirms submission, then as Clearing during the ACH return-risk period. Pending and Clearing funds are not available for Contest entry or withdrawal. Reserved Contest Funds and winnings within the reporting window are also unavailable for withdrawal. You may request withdrawal of your Available Balance, subject to applicable reviews and holds.

## Prohibited Conduct
You may not use the Platform while located outside an Approved Jurisdiction, circumvent geolocation or identity verification controls, use a chess engine, AI tool, or other outside assistance during a Contest, collude or manipulate Contest outcomes, or exploit bugs or errors for competitive advantage.

## Fair Play, Anti-Cheating, and Integrity Review
ChessBet protects competitive integrity through server-authoritative move validation, game-state recording, result determination, and chess-clock enforcement; automated post-game Stockfish screening; rule-based behavioral checks; player reporting; dispute records; and confidential administrative review.

ChessBet queues completed Contests for post-game screening. Depending on the available game data, the screening may evaluate engine move agreement, centipawn loss, critical-position performance, per-move timing, and focus-loss events. ChessBet may also identify patterns such as repeated opponent pairings, unusual resignations, or unusual timeouts for closer review.

Automated screening results and rule-based flags are indicators only. They do not, standing alone, establish cheating or trigger an automatic finding, Account penalty, financial action, or Contest enforcement. ChessBet reviews available game records, technical records, reports, dispute evidence, Account history, and other relevant evidence before making an enforcement decision.

During an Integrity Review, funds for the affected Contest may be held. ChessBet does not retain any Contest Entry Amount or Platform Service Fee as revenue from a Contest resolved through Integrity Review. Users may appeal an Integrity Review disposition within seven (7) calendar days of notification.

## Account Suspension, Restrictions, and Closure
ChessBet may suspend, restrict, or close your Account, or place holds on your funds, for violations of these Terms, suspected fraud or collusion, failure to complete verification, or as required by law or a payment processor. Forfeiture of your Account Balance occurs only in limited circumstances described in these Terms, and never authorizes ChessBet to retain forfeited Contest Entry Amounts as revenue.

## Dispute Handling
Contest concerns should be reported through the Platform within the standard twenty-four (24) hour reporting window. Contest outcomes and settlement disputes are governed by the Official Rules. For other Account or Platform disputes, you agree to first attempt informal resolution with ChessBet before pursuing formal dispute resolution.

## Disclaimer of Warranties and Limitation of Liability
The Platform is provided "as is" and "as available," without warranties of any kind, and ChessBet does not warrant or guarantee any particular Contest outcome or financial result. To the maximum extent permitted by law, ChessBet's aggregate liability is limited as described in these Terms.

## Governing Law and Dispute Resolution
These Terms are governed by the laws of the State of Michigan. Disputes are resolved through binding arbitration administered by the American Arbitration Association, with a class action waiver and jury trial waiver, subject to your right to opt out by written notice within thirty (30) days of creating your Account.

## Changes to These Terms
ChessBet may modify these Terms at any time. Continued use of the Platform after a modification's effective date constitutes acceptance of the modified Terms.

## Contact
Questions about these Terms of Service can be sent to {{SUPPORT_EMAIL}}.`
  },
  privacy_policy: {
    route: "/privacy-policy",
    label: "Privacy Policy",
    title: "ChessBet Privacy | Identity, Payment & Account Data",
    description: "Learn how ChessBet collects, uses, and protects your personal data, including identity verification, payment details, and account activity information.",
    version: "3.2",
    lastUpdated: "September 12, 2026",
    supportEmail: "hello@worldchessbet.com",
    markdown: `## Information We Collect
We collect information you provide directly — identity information (name, date of birth, and government-issued ID when required), account information (email, username, and hashed password), identity and bank-account verification information (through Seamless and its hosted Plaid authorization flow), payment and transaction information (through Seamless), and customer support communications.

Bank credentials and complete bank account numbers are entered only in the Seamless-hosted Plaid flow and do not enter ChessBet.

## Information Collected Automatically
We automatically collect device and technical information, geolocation information (via MaxMind, used to confirm you are located in an Approved Jurisdiction), account activity such as login history and session data, and essential browser storage. Optional public-page analytics and advertising measurement are collected only when enabled through Cookie settings; Global Privacy Control keeps optional tracking off.

## Information Generated by the Platform
ChessBet generates and maintains Contest records, Internal Ledger records (deposits, Contest Entry Amounts, Platform Service Fees, and withdrawals), Integrity Review records, and audit and security logs associated with your account and activity.

## How We Use Information
We use this information to create and secure your account; verify your identity, age, and geographic eligibility; process deposits and withdrawals; facilitate and settle Contests; detect and prevent fraud and other prohibited conduct; support our AML/KYC and Financial Integrity Program; resolve disputes; and meet legal and regulatory obligations.

## Third-Party Service Providers
ChessBet works with third-party providers to operate the Platform, including Base44 (hosting and infrastructure), Seamless (bank authorization and payment processing), Plaid through Seamless's hosted authorization flow (bank-account connection), MaxMind (geolocation and risk assessment), Google Analytics (optional public-page analytics), and Meta (optional public-page advertising measurement). Information is shared with these providers only as reasonably necessary for them to perform their designated functions.

We also use optional public-page measurement, when permitted, to understand site usage and advertising performance.

## Data Storage and Security
We use encryption of data in transit, encryption of sensitive data at rest where supported, access controls, and administrative, technical, and physical safeguards to protect your information. No method of storage or transmission is completely secure.

## Account Closure and Data Retention
You may request closure of your account, subject to resolution of any pending Contests, outstanding balances, or active investigations. Records related to identity verification, financial transactions, Contest history, and compliance activities are retained for a minimum of seven (7) years, or longer where required by applicable law or processor requirement.

## Cookies and Similar Technologies
Essential cookies and browser storage support authentication, MFA, security, requested game features, and remembering your privacy choice. Rejecting optional cookies does not prevent account access or gameplay.

Optional tracking is off until you choose it. Select Reject optional, Accept optional, or Manage preferences. Cookie settings are available in the public-page footer and your profile. Your choice applies to this browser, carries across login and navigation, and is remembered for 180 days. You can withdraw or change it at any time. Clearing browser storage or using another browser may require a new choice. If your browser prevents storage, optional tracking remains restricted and choices may not persist.

Analytics: With permission, Google Analytics measures eligible public-page visits using cookies such as _ga and _ga_JLHMN26FS2, configured to last up to 180 days. Advertising: With separate permission, Meta measures visits to eligible public pages without URL parameters; its _fbp cookie typically lasts 90 days. These providers receive technical information such as IP address and browser information when contacted. Browser settings can further limit cookies.

Optional Google and Meta tracking is not enabled on signed-in, login, registration, MFA, wallet, identity, or admin pages. We do not send identity-verification events, account identifiers, or contest amounts/results to Meta. Tracking is also suppressed on pages containing URL query parameters or fragments.

Global Privacy Control keeps both optional categories off even if an earlier choice enabled them. Withdrawing consent stops future optional collection and removes accessible optional tracking cookies; it does not automatically erase data already received by a provider. Contact us to exercise applicable data rights.

Base44 session recording and HeyCatch browser tracking are disabled as of September 12, 2026. Essential hosting, operational, fraud-prevention, and security records continue. Cookie lifetimes and the duration of browser storage are distinct from providers' server-side retention periods.

Hosted identity and bank-authorization services have their own privacy notices. Review those notices when using their services.

## Children's Privacy
ChessBet is not directed to, and is not intended for use by, anyone under the age of 18. We do not knowingly collect personal information from anyone under 18.

## International Processing
ChessBet is operated from the United States. Real-money Contest access is currently limited to users physically located in an Approved Jurisdiction within the United States.

## Your Rights
Depending on your jurisdiction, you may have the right to request access to, correction of, or deletion of your personal information, or to withdraw consent to certain processing activities, subject to applicable legal and regulatory retention requirements.

## Changes to This Policy
We may update this Privacy Policy periodically to reflect changes in our practices, services, or legal obligations. Material changes will be communicated through the Platform, and the "Last Updated" date will reflect the most recent revision.

## Contact
Questions about this Privacy Policy can be sent to {{SUPPORT_EMAIL}}.`
  }
};
