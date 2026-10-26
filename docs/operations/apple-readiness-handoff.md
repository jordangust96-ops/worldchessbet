# Apple readiness handoff — 2026-10-20

## October 26 provider update
Base44 reports native Firebase analytics starts at iOS launch and Sentry error/crash reports carry a user ID. The web privacy bootstrap below does not control these native SDKs. Use [the October 26 privacy and deletion review](ios-privacy-deletion-review-2026-10-26.md) for proposed App Privacy answers, Privacy Policy edits, and vendor-shell evidence still needed. The October 20 web assertions remain valid for the named web endpoints only.

## Implemented
- Official Rules version 13 adds Apple non-sponsorship and non-involvement disclosure; every previous paragraph is unchanged. Historical contest terms remain governed by their snapshots.
- Privacy Policy updated through the normal versioned publisher to explain optional tracking restrictions, fingerprint removal, and manual account deletion.
- The synchronous privacy bootstrap suppresses optional Base44 visitor analytics, GA4 and Meta on iPhone/iPad (including desktop-mode iPad), regardless of earlier cookie consent. Deferred libraries never initialize there. Fetch, XHR and beacon gates also suppress known optional collection endpoints.
- This deliberately includes Safari as well as WebViews because the wrapper's exact UA/bridge contract has not been verified. Desktop and other-browser consent behavior remains unchanged.
- No web imitation of Apple's ATT prompt. No ATT bridge or native permissions were added.
- Essential hosting/security, MaxMind jurisdiction checks, Socure verification, Seamless/Plaid, game telemetry and financial records are not optional advertising analytics and remain operational.
- Account deletion entry point: Profile > Delete account and personal data; public instructions /account-deletion. Fulfillment remains manual; see account-deletion-fulfillment.md.

## Required before submission — installed build evidence
1. Inspect the actual exported IPA's SDK inventory, privacy manifests, tracking domains, permissions and any IDFA access. Confirm the native shell adds no tracking. This web release cannot prove native-shell behavior.
2. Capture a fresh-install network trace on an iPhone and iPad before/after all privacy choices, login and navigation. Confirm no GA/Meta/optional Base44 requests; check iPad desktop UA and returning users with old consent.
3. If any native or third-party tracking remains, remove it or implement and test native ATT before tracking. Cookie consent is insufficient. Do not mark App Store privacy tracking answers solely from this web audit.
4. Exercise Apple sign-in and token revocation during manual deletion with a disposable account; never use a funded real account.
5. Test camera/location prompts, Socure return, hosted bank OAuth return, device back/foreground transitions, reconnect and clock behavior. Do not submit live transfers or paid matches as a test without separate financial authorization.
6. Validate notch/home-indicator safe areas, keyboard, orientation, text sizing, VoiceOver, navigation/back stack and external legal links on the installed build. Existing BottomNav has a safe-area spacer; automated scan findings are not proof of broken behavior.
7. Preserve free-play worldwide access and existing cash gating: verified 21+, US residency, physical supported-state evidence, fresh pre-match checks, funding availability, holds and idempotency.
8. Apple account/legal-distribution eligibility and any needed legal documentation remain owner tasks. Official Rules disclosure does not establish state legality or App Store approval.

## Validation
91 privacy assertions cover default/withdrawn/GPC consent, private routes, iPhone/iPad/desktop-iPad, old grants, Accept, deferred script suppression, fetch/XHR/beacon blocking, storage cleanup and essential request pass-through.
Build and focused frontend lint pass. Account-closure, challenge lifecycle/settlement and funding-provenance/journal suites pass with isolated storage/providers and no live financial actions.
Protected jurisdiction, identity, match-location, eligibility, closure and ledger file hashes match the prior working release.

## Official references
- https://developer.apple.com/app-store/review/guidelines/ — 5.3.2 contest disclosure
- https://developer.apple.com/app-store/user-privacy-and-data-use/ — ATT includes tracking within an app WebView
