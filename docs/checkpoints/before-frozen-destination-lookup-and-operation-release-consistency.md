# Before frozen destination lookup and operation release consistency

Date: 2026-10-03
Baseline commit: 4639a6bd92428aad9e0c8819162271ac018dc7e7

## Safety boundary

Code/schema/test/checkpoint writes only. No publish, live function/workflow invocation, provider request, payment retry, cancellation, release, or live entity mutation. Entity reads below are fingerprint-only. All executable verification uses isolated mocks and a network-denying assertion preload.

## Fresh evidence

User reports post-publish $10 withdrawal 6ac0ffa858d9771269dfa357, idempotency a317b26b-5ca3-4a31-ab7d-1c625c596a72, frozen Acorns source ace8a1d7-1c71-488d-ac4d-461012b5eb13, queued then processed Oct 3 at 09:30 America/Detroit. The transaction was released/failed as withdrawal_destination_missing without a payment reference or submitted payment.

Read-only baseline this turn:
- WalletTransaction 6ac0ffa858d9771269dfa357: failed/failed, updated 2026-10-03T13:31:17.255000; SHA256 35b63ded99036bdaf95c9d90d5fe9ad8d4ebde29599a6a38a1e1046fc931e8e1.
- SeamlessOperation 6ac0ffaa03a7057211df88c7: currently released, withdrawal_destination_missing, updated 2026-10-03T13:30:55.585000; SHA256 200a66766b9bb47cbccb4b81838f266dd7c8e818a9e3cd05c5078bf12f31dfa2. This differs from the user's earlier reserved snapshot; no change was made by this work.
- SeamlessBankAccount 6aa1ccdb6b99b75629f46fb2: verified, primary true, updated 2026-09-09T22:45:59.869000; SHA256 ac6666054bb516858251e438cabf145de2a460decb65913eb782703e84e64fc7.
- Earlier protected transactions 6ac0f3837594bd52f0055308 and 6abd4f0f079588d83c2b1abd retain hashes 648ad8fec631e5ba83331cf68a659dc4fa54c962b1131f94e79fdf2602ccaeed and 1c731216a2228e3357e14f795b8f5ab791bc4fb4ac3c32f4b7c4a35107a3bfba.

## Current source and contract inspection

Read submitSeamlessWithdrawal, verifiedWithdrawalBody, bank/profile/wallet/operation schemas, ledger, fee/release transitions, atomic store, compliance evidence, provider client/builder, limitedWithdrawal, worker, and every current withdrawal-specific regression including browser test source (browser test is not executed). Existing withdrawal test assertions remain intact.

Installed SDK entities.js confirms filter(query, sort, limit, skip, fields) returns a plain array; only the options-object overload returns a cursor page. Read-only live positional queries also returned plain arrays. Production uses npm:@base44/sdk@0.8.38 positional filters. No invented .data/.items envelope is justified on those calls.

## Exact reachable failure paths

1. submitSeamlessWithdrawal preserves prior.funding_source_id locally, but verifiedWithdrawalBody then ignores it for selection: recipient.filter(isPrimaryOf && provider user equality). An exact, credit-eligible saved source that is not returned as current-primary yields zero rows and withdrawal_destination_missing. A local verified primary record does not prove the provider GET returned the same primary/owner primitive. The actual failing GET payload is unavailable; no live provider call is authorized, so its shape is not asserted as fact.
2. The definitive branch writes an uncertain audit, posts release with ledger's default updateTransactions=true, marks WalletTransaction failed, releases the fee, writes Redis failed, and finally writes the audit released. An interrupted/failed later write can leave a successfully released wallet paired with stale reserved/submitting/uncertain audit evidence. upsertOperationAudit is also keyed only by idempotency key, not the user. There is no durable release intent recovery before submitting/failed short-circuits.

## Minimal correction planned

Validate the exact frozen source and same-user ownership, not today's primary. Normalize identifier/status primitives; accept only the actual positional-array entity contract and existing provider success/list-array contract; ambiguous/malformed/failed reads stay reserved for review. Reject deleted, reconnect-required, and conflicting duplicate exact sources safely.

Persist scoped, sanitized release intent before deterministic journal release. Disable automatic transaction rewriting for that release journal. Complete fee/Redis/audit release before the final failed transaction write, with stable completion timestamps and safe same-request interruption recovery; refuse to replace submitted/processing/completed/succeeded/uncertain/ambiguous/review-required evidence. Add only the audit fields needed to retain the release reason/message/group/time, preserving all access rules.

Retain all existing assertions, adapt obsolete current-primary fixtures to exact-source conflicts, and add production-ID fixtures plus full handler/journal interruption tests. Run the same 24 isolated suites, production build, diff check, changed-source re-read, and before/after live fingerprint comparison before writing the verified checkpoint.

## Remaining provider limitation

The documented body currently uses recipient user ID plus merchant sender account; sourceId is validation-only and not an outgoing recipient-source selector. Do not invent an undocumented provider parameter. No live payout or routing proof will be claimed.

State: BEFORE; no production edits made yet.