# Checkpoint: Before authenticated MaxMind access enforcement

Created: 2026-08-31 (America/Detroit)

State captured immediately before implementing authenticated MaxMind access
enforcement. Part 1 = backend/helper changes only (no frontend guard yet).

## Secrets / flags at this checkpoint (unchanged by Part 1)
- `MAXMIND_GEOIP_ENABLED` = true (secret — not modified)
- `MAXMIND_ADMIN_FORCE_LIVE_CHECKS` = true (secret — not modified)
- `EARLY_ACCESS_MODE` = true (`base44/shared/earlyAccess.ts` — not modified)

## Behavior at this checkpoint (prior state)
- `isGeoipEnforcementEnabled(maxmindGeoipEnabled, earlyAccessMode) =
  !!maxmindGeoipEnabled && !earlyAccessMode` → with `EARLY_ACCESS_MODE=true`,
  returns **false**, so ordinary `getCurrentJurisdiction` calls return an
  approved bypass with **no** MaxMind lookup and **no** audit log.
- `isReusableVerification` accepts approved/blocked and `verification_failed`
  +VPN records; it does **not** inspect `enforcement_bypassed`,
  `geolocation_enforcement_enabled`, or `provider`.

## Part 1 changes applied after this checkpoint
- `isGeoipEnforcementEnabled` now depends **only** on `MAXMIND_GEOIP_ENABLED`.
  With the secret already `true`, enforcement is now **on** even while
  `EARLY_ACCESS_MODE` remains `true`.
- `isReusableVerification` hardened: only a fresh (<15 min), same-user,
  exact-same-IP, real MaxMind, `geolocation_enforcement_enabled=true`,
  `enforcement_bypassed!=true`, final `approved`/`blocked` record is reusable.
  Providerless / disabled-era / bypassed / stale / wrong-user/IP records and
  `verification_failed`/`unknown` results are never reusable — so the earlier
  activation-test bypass can never be reused after enforcement activates.
- `getCurrentJurisdiction` no longer imports `EARLY_ACCESS_MODE`; the
  Early-Access approved-bypass early-return and the post-lookup override are
  removed. Fail-closed provider-error handling, anonymizer/VPN blocking, audit
  logging, 15-minute cache, admin force-live safety, and all response fields
  are preserved. `enforcement_bypassed` is now always logged `false`.
- Ten-state allowlist unchanged: `AR CO GA IA KS ND TX VA WI WY`.
- Payment Early Access gates and money movement are untouched
  (`submitSeamlessDeposit` / `submitSeamlessWithdrawal` still fail closed at
  `EARLY_ACCESS_MODE`; `runContestEligibility` identity check still bypassed
  while `EARLY_ACCESS_MODE=true`).

## Rollback
Revert `base44/shared/jurisdictionGates.js`,
`base44/functions/getCurrentJurisdiction/entry.ts`, and
`scripts/validate-jurisdiction-gates.mjs` to their pre-Part-1 state
(`git revert` of the Part-1 commit, or restore from this checkpoint).