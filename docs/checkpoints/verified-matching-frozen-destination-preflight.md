# Verified: matching frozen destination cannot produce withdrawal_destination_changed

Date: 2026-10-03
Preceded by: `before-matching-frozen-destination-preflight.md`.

## Diagnosis (confirmed)

The Oct 3 8:45 AM scheduler run that released wallet transaction `6ac0f3837594bd52f0055308` with `last_error_code: withdrawal_destination_changed` ran **pre-hardening code**. The hardening commit was created this session and production deployment was an open todo at the prior checkpoint. The old `buildVerifiedWithdrawalBody` collapsed every non-matching-primary case (empty primary, multiple primary, source_id mismatch, status not `verified`) into the single `withdrawal_destination_changed` code, so a genuinely matching frozen destination (source_id `ace8a1d7-1c71-488d-ac4d-461012b5eb13`, verified, primary) was misclassified as "changed" and the reservation was released with no payment sent.

The current hardened code had a latent defect that could still misclassify an actually matching frozen destination as `withdrawal_destination_changed`:
1. `row.is_primary === true` was strict; a provider `is_primary` of `"true"` or `1` yielded zero primary rows.
2. `primary[0].source_id` was read with no `id` fallback; if the provider returns the funding-source id under `id`, `primary[0].source_id` was `undefined` and `undefined !== input.sourceId` fired `withdrawal_destination_changed`.

## Fix

`base44/shared/verifiedWithdrawalBody.ts`:
- `sourceIdOf(row) = String(row.source_id || row.id || '').trim()` normalizes the funding-source id for both recipient primary selection and merchant Balance selection.
- `isPrimaryOf(row)` accepts `true`, `"true"`, or `1`.
- `user_id` comparison coerces both sides to strings.
- `withdrawal_destination_changed` fires only when the primary's normalized source id is non-empty AND differs from the frozen `input.sourceId`. An empty normalized primary source id is an indeterminate provider read (`withdrawal_sources_unavailable`, `withdrawalIndeterminate: true`), so funds stay reserved and the request is never released as a rejection.

## Regression fixture

`scripts/validate-withdrawal-routing.mjs` adds a fixture using the exact production IDs and lifecycle facts:
- Wallet transaction `6ac0f3837594bd52f0055308`, frozen `funding_source_id` `ace8a1d7-1c71-488d-ac4d-461012b5eb13`, `status: verified`, `is_primary: true`.
- Three provider response-shape variants: `source_id` + `is_primary: true`; `id` + `is_primary: "true"`; `source_id` + `is_primary: 1`.
- Each variant asserts preflight passes (returns the merchant Balance sender) with zero provider POSTs — never `withdrawal_destination_changed`.
- An additional case asserts an empty primary source id is indeterminate (`withdrawal_sources_unavailable`, not definitive, zero POSTs).

## Verification

- Full isolated suite: 24 command executions pass; 217,941 completed assertion calls. The routing suite now includes the production matching-destination fixture and the empty-source-id indeterminate case.
- `npm run build`: exit 0; Vite build and public prerender (FAQ, About, Fair Play, 3 legal pages, Blog, 45 native articles) complete.
- `git diff --check`: clean; no whitespace findings.
- Trailing-whitespace scan of edited files: clean.

### Protected transaction fingerprints (unchanged this turn)

| Transaction | updated_date | status / integration_status | SHA-256 |
| --- | --- | --- | --- |
| 6ac0f3837594bd52f0055308 | 2026-10-03T12:45:51.701000 | failed / failed | 648ad8fec631e5ba83331cf68a659dc4fa54c962b1131f94e79fdf2602ccaeed |
| 6abd4f0f079588d83c2b1abd | 2026-10-02T14:30:57.021000 | failed / failed | 1c731216a2228e3357e14f795b8f5ab791bc4fb4ac3c32f4b7c4a35107a3bfba |

No live financial/provider function or workflow was invoked. Neither protected withdrawal record was mutated or retried.

## Changed files this turn

1. base44/shared/verifiedWithdrawalBody.ts
2. scripts/validate-withdrawal-routing.mjs
3. docs/checkpoints/before-matching-frozen-destination-preflight.md
4. docs/checkpoints/verified-matching-frozen-destination-preflight.md (this file)

**Checkpoint status: VERIFIED.**