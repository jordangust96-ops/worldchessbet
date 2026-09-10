# Deposit flow audit — 2026-09-10

## Repairs
- Preserve original trusted request IP for in-process deposit jurisdiction verification; same location policy remains fail-closed. Forward jurisdiction context through MFA, policy and app layout routes to wallet.
- Require location before new identity evaluation and KYC before hosted bank onboarding. Preserve bank onboarding for verified players recovering an existing withdrawable balance outside eligible locations.
- Recheck verified primary funding source under transfer lock; reject stale UI bank selection.
- Enforce valid monetary precision and deposit limits; improve terminal-decline and uncertain-request retry behavior and customer feedback.
- Add concise location status before identity status, validate hosted Plaid URL origin, and recover wallet loading failures without an endless spinner.

## Validation
Passed validate-deposit-user-flow, validate-jurisdiction-gates (103 assertions), validate-jurisdiction-waitlist (129), validate-socure-identity, validate-socure-return, validate-kyc-archive-compression, validate-seamless-hosted, validate-seamless-races, validate-seamless-status-recovery, validate-funding-source-traceability. Final lint and production build passed after final UI changes. Only nonblocking stale Browserslist data warning.

Mocked deposit tests cover original-IP propagation, missing/blocked location, KYC/21+, holds, missing/unverified bank, primary-bank races, invalid amounts, acceptance without immediate credit, durable decline, uncertain response and duplicate replay. No real ACH request, new identity evaluation, bank change or balance adjustment was made.

## Remaining live verification
Frontend publication was attempted but could not be confirmed: Chrome automation repeatedly lost debugger attachment, including a fresh editor tab. Publication and final live desktop/mobile amount-control checks remain unverified. Earlier live wallet inspection showed identity verified, Acorns connected, $10 pending and $0 available; it preceded this audit's frontend publication. Existing admin jurisdiction bypass means this session is not evidence of ordinary-player geolocation success. No legal eligibility certification is implied.
