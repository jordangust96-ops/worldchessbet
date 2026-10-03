# Before Seamless documented Direct Credit simplification

Date: 2026-10-03
Baseline: `c31f1de3` (Verified frozen destination lookup and operation release consistency)
Follows: `verified-frozen-destination-lookup-and-operation-release-consistency.md`

## Intent

Simplify the payout submission critical path to match Seamless's official Online Gaming Guide and Direct Credit reference:
- https://developers-ach.seamlesschex.com/docs/online-gaming-guide
- https://developers-ach.seamlesschex.com/reference/create-ach-direct-credit

## Diagnosis of the current code (what contradicts the official contract)

The official Direct Credit flow is: create a customer, add a funding source, then `POST /ach/v2/check/send` with `recipient`, `name`, `amount`, `description`, `label`, plus `account` (the merchant sender) only when applicable. The reference documents **no** requirement to list a recipient's funding sources before the credit.

The current `base44/shared/verifiedWithdrawalBody.ts` `buildVerifiedWithdrawalBody` adds an **undocumented** provider preflight on the payout critical path:

1. `GET /account` to discover the merchant user id.
2. `GET /funding-source/user/:merchant` to find the merchant Balance sender source.
3. `GET /funding-source/user/:recipient` to list the recipient's funding sources and require the exact frozen source to be present in that list.

Step 3 is the undocumented recipient funding-source-list read. It is what produced the indeterminate `withdrawal_sources_unavailable` classification for the live protected withdrawal `6ac13ae2baa82122f2b8109d` on 2026-10-03 at ~17:46Z: the recipient list GET returned an ambiguous shape, so the preflight could not definitively confirm or reject the destination, leaving funds reserved in `review_required` with zero POST.

This contradicts the Direct Credit contract, which only needs the customer profile (already persisted in `SeamlessPaymentProfile`) and a connected funding source (already persisted in `SeamlessBankAccount`).

## Safety boundary

- Code, schema, test, and checkpoint writes only.
- Do NOT publish, invoke any live financial function/workflow, or call any Seamless/provider endpoint.
- Preserve `WalletTransaction 6ac13ae2baa82122f2b8109d` and `SeamlessOperation 6ac13ae46f19d1765198051a` exactly as-is. They are `pending/uncertain/review_required` with funds reserved and no provider POST/reference; this correction must not make them eligible for automatic retry.

## Planned change (smallest coherent)

1. `base44/shared/verifiedWithdrawalBody.ts`: remove every provider GET from `buildVerifiedWithdrawalBody`. Validate only ChessBet's locally persisted frozen destination (`SeamlessBankAccount` by `user_id` + `source_id`) and customer mapping (`SeamlessPaymentProfile.provider_user_id`). Reject deleted/login_required/error/verification_failed/verification_expired destinations locally with zero POST via the existing idempotent release path. Indeterminate local read failure stays reserved + `review_required` with zero POST. Credit-eligible statuses (added/pending_verification/verified) are allowed because verification is required for debits, not credits.
2. `base44/shared/seamlessAchPure.js` `buildWithdrawalBody`: make `account` optional — include it only when a merchant sender source id is explicitly provided; never send the recipient `source_id` as `account`; truncate `description` to 128 chars.
3. `base44/functions/submitSeamlessWithdrawal/entry.ts`: pass an optional configured merchant sender source id (`SEAMLESS_MERCHANT_SENDER_ACCOUNT`) into the body builder. No configured value means `account` is omitted, matching the documented contract.
4. `base44/functions/processQueuedWithdrawals/entry.ts`: the read-only `inspectFunding` admin diagnostic runs the same local validation.
5. Retire/rewrite tests whose only purpose was the undocumented GET; add production-shaped tests proving the documented Direct Credit flow.

## Protected records (pre-change fingerprints)

| Record | updated_date | status / integration_status | state |
| --- | --- | --- | --- |
| WalletTransaction 6ac13ae2baa82122f2b8109d | 2026-10-03T17:46:23.836000 | pending / uncertain (review_required) | funds reserved, no provider POST/reference |
| SeamlessOperation 6ac13ae46f19d1765198051a | 2026-10-03T17:46:24.008Z | uncertain (last_error_code withdrawal_sources_unavailable) | reserved, no provider reference |

These must remain unchanged by this correction.