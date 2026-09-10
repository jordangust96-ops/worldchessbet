# ChessBet KYC restoration and interim age policy
Date: September 10, 2026

## Decision and scope

Jordan approved an interim platform minimum of 21 for real-money activity in the app's existing state list: AR, CO, GA, IA, KS, ND, TX, VA, WI, WY. These are configured states, not states independently certified as legally approved by this review. No state was added. Age 21 is a product restriction, not a legal opinion or permission to operate.

Socure is restored for player identity/age verification only. Seamless's hosted Plaid integration remains responsible for bank authorization and ACH money movement. No Socure bank-verification flow is restored.

## Implemented safeguards

- Production consumer_onboarding workflow only. Browser redirects and bank-verification webhooks cannot grant player KYC.
- Authenticated Socure result must ACCEPT and include corroborated DOB and legal-name evidence. Missing/conflicting evidence remains under review.
- Under-21 results cannot unlock real-money activity. Unknown states remain blocked by the age policy in addition to existing jurisdiction checks.
- Server-side deposit, withdrawal, account-closure payout, contest eligibility and wallet-reservation checks require a current retained KYC record, not an editable profile flag.
- User-level concurrency locks serialize identity updates with wallet mutations. Duplicate callbacks repair interrupted account-status updates.
- Incomplete hosted sessions are reused; uncertain provider outcomes are not blindly submitted again. Three new attempts per day maximum.
- Raw Socure evidence is encrypted before persistence. Verified legal name is retained separately for bank-authorization consistency; raw DOB/SSN/documents are not copied into the User record.
- Existing bank connections, ACH authorizations, wallet balances and settlement/return safeguards are preserved.
- Wallet has a separate identity step, pending/review/failure messaging and a support route for existing funds.
- A read-only admin health check, getSocureIdentityReadiness, checks configuration, encryption and lock-store health without starting a billable identity evaluation.

The current implementation uses a one-year KYC evidence-validity window and extends evidence retention to at least two years after transfer activity. These operational defaults require confirmation against counsel/provider retention and reverification requirements; they are not represented as statutory periods.

## State-law research: preliminary, not launch clearance

The question is not simply whether skill gaming is 18+ or 21+. Counsel must classify ChessBet's particular player-funded prize pool, entry charge, platform fee, online delivery and contest rules. Casino, sportsbook and fantasy-sports ages must not be copied onto chess contests without establishing that the relevant legal category applies.

| State | Relevant source and finding | Interim product minimum |
| --- | --- | --- |
| Arkansas | Section 5-66-113 prohibits betting money or value on games of hazard or skill. This is a material red flag requiring a specific written review of ChessBet's structure; no age threshold resolves it. [Official lottery-hosted statutes](https://www.myarkansaslottery.com/sites/default/files/components/files/illegal_gambling_and_gaming_statutes_5-66-101_to_5-66-120.pdf), current through 2025 legislation/November revisions. | 21, not legal clearance |
| Colorado | Section 18-10-102 excludes certain bona fide skill contests from gambling. The reviewed official compilation is 2024; current amendments and application to this structure remain to be verified. [Official compilation](https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-18.pdf). | 21 |
| Georgia | Section 16-12-20 excludes certain prizes offered to actual contestants in bona fide skill contests. The official-hosted copy reviewed is dated 2021; current law/application requires confirmation. [Georgia Lottery publication](https://www.gacoam.com/API/Documents/Document?documentID=459). | 21 |
| Iowa | Section 99B.61 expressly includes chess and allows certain entry-fee contests subject to fairness and other conditions. It does not itself establish a universal 21+ chess rule. [2026 statute](https://www.legis.iowa.gov/docs/code/2026/99B.61.pdf). | 21 |
| Kansas | Section 21-6403 excludes specified bona fide skill-contest prizes from its bet definition. Classification of the particular offering remains necessary. [2025 statute](https://kslegislature.gov/media/statute/021_000_0000_chapter/021_064_0000_article/021_064_0003_section/021_064_0003_k.pdf). | 21 |
| North Dakota | Chapter 12.1-28 excludes lawful skill contests from gambling. This does not independently establish that a given online contest is lawful. [Official code](https://ndlegis.gov/cencode/t12-1c28.pdf). | 21 |
| Texas | Section 47.01 excludes specified prizes for actual contestants in bona fide skill contests. It is not blanket authorization for every fee/prize structure. [Official code](https://tcss.legis.texas.gov/resources/PE/htm/PE.47.htm). | 21 |
| Virginia | Section 18.2-333 provides a skill-contest exception involving participants and prizes/purses/stakes. The exception itself does not prescribe a general 21+ threshold. [Official statute](https://law.lis.virginia.gov/vacode/title18.2/chapter8/section18.2-333/). | 21 |
| Wisconsin | State guidance distinguishes skill from chance in contests and promotions. This older guidance does not clear ChessBet's wagering/prize structure or establish its age requirement. Current section 945.01 and relevant case law need counsel review. [State guidance](https://charitable.wi.gov/Content/PDF/ContestsSweepstakesPromotions%204.15.pdf). | 21 |
| Wyoming | Section 6-7-101 excludes specified bona fide skill contests but expressly excludes skill-based amusement games from that exception. The reviewed legislature-hosted text states effective July 1, 2026. [Statute](https://wyoleg.gov/InterimCommittee/2026/S44-20260514WS6-7-101.pdf). | 21 |

Before treating any state as legally approved, obtain gaming counsel's written assessment of the exact business model, minimum age, permitted locations, licensing/registration, consumer disclosures, AML/sanctions obligations and handling/return of player funds. Arkansas deserves immediate attention. The integration does not certify legal segregation of funds or legal compliance.

## Remaining live rollout checks

1. Restore Chrome extension access. It began returning "Debugger unattached"; a fresh tab and reconnect attempts did not resolve it.
2. Set SOCURE_IDENTITY_ENABLED=true in Base44 Secrets. Keep legacy SOCURE_ENABLED bank services disabled. Confirm production consumer_onboarding configuration and existing API/webhook credentials without exposing them.
3. Run getSocureIdentityReadiness as admin; all readiness flags must pass.
4. Confirm Socure's hosted workflow actually includes the purchased KYC/watchlist modules and the DOB/name evidence used by this policy. Do not reduce evidence requirements just to obtain a green status.
5. Verify callback authentication/delivery and configure final/updated-decision event subscriptions as supported. A bank-screening subscription must never grant KYC.
6. Publish the wallet frontend from Base44 and inspect the live wallet.
7. Complete a consenting adult's real hosted verification, with that person supplying their own sensitive information. Check ACCEPT plus verified DOB/name evidence, bank preservation, and a failed/review result. Do not run real ACH transfers or paid contests merely as a software test.
8. Run the admin identity reconciliation after deployment to remove obsolete bank-derived identity snapshots. It never promotes a bank connection to KYC.

Until the live rollout checks pass, do not describe the Socure integration as fully activated or launch-ready.

## Provider references

- [Socure hosted KYC guide](https://help.socure.com/riskos/docs/kyc-watchlist-screening-integration-guide-for-startups)
- [Socure KYC evidence fields](https://help.socure.com/riskos/docs/verify-integration-guide)
- [Socure document evidence fields](https://help.socure.com/riskos/docs/docv-webhook-payload-reference)
- [Socure webhook configuration](https://help.socure.com/riskos/docs/webhook-configuration-reference)
