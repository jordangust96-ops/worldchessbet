# Before: matching frozen destination must not produce withdrawal_destination_changed

Date: 2026-10-03
Scope: `base44/shared/verifiedWithdrawalBody.ts` preflight classification + regression coverage.

## Fresh production evidence (read-only, post prior verification)

- `SeamlessOperation` for wallet transaction `6ac0f3837594bd52f0055308` is now released at Oct 3 8:45 AM with `last_error_code: withdrawal_destination_changed`, `attempts: 1`, and still no `provider_reference_id`.
- Live `WalletTransaction` has `funding_source_id: ace8a1d7-1c71-488d-ac4d-461012b5eb13`.
- Live `SeamlessBankAccount` for this user has the same `source_id: ace8a1d7-1c71-488d-ac4d-461012b5eb13`, `status: verified`, `is_primary: true`.
- The wallet now shows the $10 request as Not applied and the funds released. No payment was sent.

So the destination genuinely matches the frozen snapshot, yet the prior run classified it as `withdrawal_destination_changed` and released the reservation.

## Diagnosis

- The 8:45 scheduler ran **pre-hardening code**. The hardening commit was created this session and production deployment was an open todo at the prior checkpoint. The old `buildVerifiedWithdrawalBody` collapsed every non-matching-primary case (empty primary, multiple primary, source_id mismatch, status not `verified`) into the single `withdrawal_destination_changed` code. An empty primary — produced by a transient provider read, a non-strict-`true` `is_primary`, or a `user_id` shape difference — therefore emitted `withdrawal_destination_changed` for a destination that actually matched.
- The current hardened code retains a latent defect that can still misclassify an actually matching frozen destination as `withdrawal_destination_changed`:
  1. `row.is_primary === true` is strict. If the provider returns `is_primary` as `"true"` (string) or `1`, the primary filter yields zero rows → `withdrawal_destination_missing` (still a false release, different code).
  2. `primary[0].source_id` is read with no `id` fallback. If the provider returns the funding-source id under `id` rather than `source_id`, `primary[0].source_id` is `undefined`, `undefined !== input.sourceId` → `withdrawal_destination_changed`, releasing funds for a matching destination with no payment sent — the exact production symptom.

## Planned correction

- Normalize the funding-source id from each provider row as `row.source_id || row.id` (trimmed), for both recipient primary selection and merchant Balance selection.
- Coerce `is_primary` leniently: accept `true`, `"true"`, or `1`.
- Compare `user_id` as coerced strings.
- Only fail `withdrawal_destination_changed` when the primary's normalized source id is non-empty AND differs from the frozen `input.sourceId`. A primary row whose normalized source id is empty is an indeterminate provider read (`withdrawal_sources_unavailable`, funds stay reserved), never a definitive release.
- Add a regression fixture using the exact production IDs and lifecycle facts, plus the observed provider response-shape variants (`source_id`/`id`, `is_primary` true/`"true"`/`1`), asserting a matching frozen destination passes preflight with zero provider POSTs.

## Constraints

- No live financial/provider function or workflow will be invoked.
- Neither protected withdrawal record (`6ac0f3837594bd52f0055308`, `6abd4f0f079588d83c2b1abd`) will be mutated or retried.

## State

No code edits made yet.