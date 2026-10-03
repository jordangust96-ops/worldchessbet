# Verified: frozen destination lookup and operation release consistency

**Checkpoint:** Verified frozen destination lookup and operation release consistency
**Date:** 2026-10-03 (America/Detroit)
**Baseline checkpoint:** fff1a8c25934aa8978c5995acfb351426920fa92

## Verification results

- **Production build:** exit 0 (`vite build` + prerender, 45 native article routes).
- **Whitespace check:** `git diff --check` exit 0.
- **Isolated regression suites:** 24/24 passed, **219,101 assertions** total.
- **Protected WalletTransaction `6ac0ffa858d9771269dfa357`:** fingerprint unchanged
  (`35b63ded…c931e8e1`, updated_date `2026-10-03T13:31:17.255000`).
- **Protected SeamlessOperation `6ac0ffaa03a7057211df88c7`** (released,
  `withdrawal_destination_missing`): fingerprint unchanged
  (`200a6676…2f31dfa2`, updated_date `2026-10-03T13:30:55.585000`).
- The separately requested id `a317b26b-5ca3-4a31-ab7d-1c625c596a72` is not
  present in this app's SeamlessOperation collection; no record was created or
  mutated to look it up. The verified protected SeamlessOperation above is the
  authoritative baseline record.

## Changed files (since fff1a8c)

- `base44/entities/SeamlessOperation.jsonc`
- `base44/functions/submitSeamlessWithdrawal/entry.ts`
- `base44/shared/verifiedWithdrawalBody.ts`
- `docs/checkpoints/before-frozen-destination-lookup-and-operation-release-consistency.md`
- `scripts/validate-documented-withdrawal-hardening.mjs`
- `scripts/validate-frozen-destination-release.mjs`
- `scripts/validate-withdrawal-routing.mjs`
- `src/docs/checkpoints/before-matching-frozen-destination-preflight.md`

## Remaining live limitation

The hardening is verified in isolation only; it has not been deployed to the
published app. Production withdrawal routing, capacity, and provider-confirmed
retry behavior remain to be confirmed against live Seamless ACH endpoints
after publish.