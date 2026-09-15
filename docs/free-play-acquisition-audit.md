# Free-play acquisition: steps 1–3
## Positioning
Real-money chess is the brand hook; free play is the easy entry. Preserve the black/gold identity, “Play chess. Win cash.”, real USD proposition, entry-choice features, prize disclosures, and fair-play content. Primary acquisition action: Play Free. Clear adjacent action: Play for Money.

## Audit
- Landing: previously cash-only description and generic Create account CTA. Now explicit free and paid actions, free-worldwide/no-deposit copy, and separate step-by-step paths.
- Signup: legal-name fields and the signup funding-name call were removed at the user's request. Email/password or social provider, email OTP, policy acceptance and MFA remain. Wallet bank connection already collects legal name if missing. No location, identity-document, bank or deposit step is required for free play.
- Auth routing: email login and MFA used the existing session redirect; social callbacks previously always used /play. Explicit mode links now preserve free/money intent through registration, login and social callbacks, then open the chosen challenge form. Invitation destinations remain when no acquisition mode is explicitly selected.
- Free challenge: defaults to free; supports time control, public listing and shareable links. Backend requires zero entry/fee and skips money-play readiness/location/funding. Free acceptance skips paid eligibility checks.
- Paid challenge: identity, verified bank, cleared balance and location checks remain. Wallet setup exposes location then identity/bank/funding steps. Pending deposits are not playable.
- Jurisdiction: free play is presented worldwide by the existing app. Paid controls remain server-enforced; cash eligibility copy links to Official Rules and specifies verified age 21+ and supported U.S. locations.
- Metadata: homepage HTML and rendered metadata now describe both routes while leading with real money.

## Scope
No payment, eligibility, match settlement, account-security or legal-policy rules changed. Dedicated SEO pages and viral acquisition-loop changes belong to later steps.

## Validation
Production build passed. Existing free-play regression suite passed 1,149 assertions. Phone (390px) and desktop (1280px) browser checks passed: cash-first heading, both CTA destinations, no horizontal overflow or runtime errors. Full-project lint reports three pre-existing unused imports in Profile.jsx and WalletPage.jsx. No real accounts, paid matches or deposits were created for validation.
