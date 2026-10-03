# Documented Seamless withdrawal hardening — verification results

Date: 2026-10-03
Scope baseline: `00e06df^` (the parent of the initial hardening commit).

## Certification status

The isolated production-handler, provider-boundary, Seamless and ledger regressions pass. The production build and both whitespace checks pass. This is a verification-results report, **not** the final `Verified documented Seamless withdrawal hardening` checkpoint: the live-schema comparison could not be completed and the legacy browser runner lacks its required Playwright installation. The requested final checkpoint is withheld until those checks pass, rather than falsely certifying them.

## Corrections and safety review

- Ready-path handler tests create a persistent queued request, then process it as an administrator. An explicit not-ready case remains covered, including duplicate invocation with zero preflight calls and zero payout POSTs.
- The original queued-withdrawal 503 was traced to the real `verifyProcessedDeposit` guard requiring the exact immutable deposit label. The ready fixture now provides that label; the production identity/label guard was not relaxed.
- Duplicate uncertain/submitting requests consistently return HTTP 202. No automatic retry occurs after an ambiguous POST or after Redis-state loss; the durable transaction preserves the uncertain state.
- Explicit provider-confirmed, administrator-controlled retry remains covered with the original transaction identity and its separate capacity key. A duplicate authorized retry sends zero additional POSTs.
- Existing requests retain their immutable bank snapshot even if the local bank is deleted/missing, so provider preflight can classify the failure and release the reservation safely instead of silently choosing a different bank.
- Missing merchant account identity is an indeterminate provider read, not a definitive rejection.
- Raw `bank.account.login.required` reaches the funding-source webhook handler, and its duplicate is a no-op.
- The test VM now exposes the native Headers constructor needed by the real webhook handler.
- Existing closure capacity assertions follow the actual `capacityKey` alias and additionally assert its default remains transactionId. Funding-journal fixtures now carry required labels and use a current creation timestamp instead of a date whose clearing window has already expired.
- Failure copy uses a whole-word NSF match: the letters `nsf` inside `transfer` no longer incorrectly describe a generic bank-transfer failure as insufficient funds.
- Changed production logic, schema and message branches were re-read against the baseline for internal consistency. No financial function/workflow was invoked live; tests use injected dependencies and the assertion-count preload disables live network access.

## Exact commands and assertion counts

Working directory: `/app`. Each row below is an exact executed command of the form:

`node --require ./scripts/helpers/count-assertions.cjs scripts/<filename>`

The preload counts completed assertion-method calls without removing or weakening assertions. The hardening suite's 51 scenario-group counter is distinct from its 238 actual assertion calls, which include the real no-POST boundary suite it imports.

| Filename substituted in the command above | Exit | Completed assertion calls |
| --- | ---: | ---: |
| validate-documented-withdrawal-hardening.mjs | 0 | 238 |
| validate-withdrawal-no-post-boundaries.mjs | 0 | 61 |
| validate-queued-withdrawals.mjs | 0 | 57 |
| validate-withdrawal-routing.mjs | 0 | 79 |
| validate-withdrawal-interruption.mjs | 0 | 22 |
| validate-withdrawal-request-email.mjs | 0 | 16 |
| validate-seamless.mjs | 0 | 86 |
| validate-seamless-races.mjs | 0 | 29 |
| validate-seamless-status-recovery.mjs | 0 | 36 |
| validate-financial-hardening.mjs | 0 | 48 |
| validate-ledger-integrity.mjs | 0 | 9 |
| validate-deterministic-ledger-group-ids.mjs | 0 | 21 |
| validate-account-closure-payout.mjs | 0 | 22 |
| validate-funding-source-traceability.mjs | 0 | 14 |
| validate-funding-provenance.mjs | 0 | 25 |
| validate-funding-journal.mjs | 0 | 39 |
| validate-deposit-pricing.mjs | 0 | 216705 |
| validate-deposit-reconciliation.mjs | 0 | 168 |
| validate-payment-tracking.mjs | 0 | 56 |
| validate-integration-contract.mjs | 0 | 56 |
| validate-pending-winnings.mjs | 0 | 36 |
| validate-pending-winnings-hardening.mjs | 0 | 33 |
| validate-settlement-transparency.mjs | 0 | 25 |
| validate-deposit-user-flow.mjs | 0 | 50 |

**24 passing command executions; 217931 completed assertion calls.** This total sums executions, so it includes the boundary suite once inside hardening and once in its standalone run.

Other checks:

| Exact command | Result |
| --- | --- |
| `npm run build` | Exit 0; Vite build and public prerender completed; 45 native blog article routes. Non-fatal stale Browserslist data warning. |
| `git diff --check` | Exit 0; no output/finding. |
| `git diff --check 00e06df^` | Exit 0; no output/finding across cumulative hardening changes. |
| `node --require ./scripts/helpers/count-assertions.cjs scripts/validate-withdrawal-wallet-browser.mjs` | Exit 1 before assertions; 0 completed. Missing `/tmp/chessbet-browser-qa/node_modules/playwright`. This is an environment blocker, not a passing browser test. |

## Zero-provider-POST invariants

- Each of the seven definitive preflight reasons explicitly asserts zero POSTs and a persisted terminal reason. Duplicate calls after terminal failure assert zero additional POSTs.
- Routing rejection cases (source mismatch, no primary, wrong owner, multiple primary, deleted, expired, login-required, missing/incorrect/deleted/duplicate merchant Balance source) individually assert zero POSTs.
- Ambiguous sources, timeout and missing merchant identity read cases explicitly assert zero POSTs and indeterminate classification.
- Indeterminate preflight handler requests and their duplicate calls assert zero POSTs; funds remain reserved rather than being released as a rejection.
- The actual read-only reconciliation handler is executed for pending, processing, hold, timeout and ambiguous response cases; each asserts zero provider POSTs and zero financial transitions. Duplicate reconciliation asserts zero POSTs and observes backoff.
- The actual scheduler is invoked twice on submitted/uncertain records, with zero submission invocations and zero POSTs. Read-only queue inspections assert zero POSTs.
- Duplicate submitting/ambiguous-POST/5xx requests assert zero additional POSTs, including recovery from lost Redis operation state.
- Duplicate financial and funding-source webhook tests explicitly assert zero POSTs.
- Capacity deferral in the real queued-handler harness asserts zero POSTs.

## Schema and RLS verification

Three local schema assertions passed:

1. SeamlessBankAccount RLS deep-equals the pre-hardening baseline.
2. Required fields deep-equal the baseline.
3. The status enum declares `login_required`.

Preserved rules: admin-only create and update; owner-only read via `data.user_id == {{user.id}}`; delete denied.

**Live registered schema not confirmed.** The installed entities SDK exposes record operations but no schema-read method. A read-only authenticated schema metadata request returned HTTP 401. Documentation identifies `list_entity_schemas` as the live-schema inspection tool, but that tool is not available in this session. Reading the checked-in source is not evidence of a matching live deployment. No schema was rewritten merely to fabricate verification, and no live records were changed.

## Protected transaction comparisons

Canonical full-record SHA-256 hashes matched between the first verification read and the final read:

| Transaction | Status at both verification reads | updated_date at both reads | SHA-256 |
| --- | --- | --- | --- |
| 6ac0f3837594bd52f0055308 | failed / integration failed | 2026-10-03T12:45:51.701000 | 648ad8fec631e5ba83331cf68a659dc4fa54c962b1131f94e79fdf2602ccaeed |
| 6abd4f0f079588d83c2b1abd | failed / integration failed | 2026-10-02T14:30:57.021000 | 1c731216a2228e3357e14f795b8f5ab791bc4fb4ac3c32f4b7c4a35107a3bfba |

No writes, retries, releases or cancellations were performed on either transaction by this verification. The original checkpoint referred to the first record as pending; the first actual verification read already found it failed, so this report does not claim it stayed unchanged from that earlier, unobserved pending state.

## Exact cumulative changed-file list

Relative to `00e06df^`, including this report and newly created verification helpers:

1. base44/entities/SeamlessBankAccount.jsonc
2. base44/functions/seamlessAchWebhook/entry.ts
3. base44/functions/submitSeamlessWithdrawal/entry.ts
4. base44/shared/seamlessAchPure.js
5. base44/shared/verifiedWithdrawalBody.ts
6. docs/checkpoints/before-documented-seamless-withdrawal-hardening.md
7. docs/checkpoints/documented-seamless-withdrawal-verification-results.md
8. scripts/helpers/count-assertions.cjs
9. scripts/helpers/load-backend.mjs
10. scripts/validate-account-closure-payout.mjs
11. scripts/validate-documented-withdrawal-hardening.mjs
12. scripts/validate-funding-journal.mjs
13. scripts/validate-queued-withdrawals.mjs
14. scripts/validate-withdrawal-routing.mjs
15. scripts/validate-withdrawal-no-post-boundaries.mjs
16. src/components/wallet/TransactionHistory.jsx
17. src/components/wallet/transferFailureCopy.js

The temporary debug script created in an earlier turn was removed; it has no net change relative to the pre-hardening baseline. No workflow, ledger, wallet, existing transaction, bank-account record or provider configuration was modified.

## Remaining unverified limitations

- Live entity-schema/RLS equality needs an authorized live-schema inspection surface; it is not certified here.
- The browser withdrawal regression needs its existing Playwright/browser environment restored, or equivalent browser QA via the Testing Agent.
- Actual provider GET endpoints, live merchant funding-source responses, delivery of new lifecycle webhooks, and real payout acceptance/arrival were intentionally not exercised. An absent provider payment reference still requires manual/provider reconciliation, never automatic payout retry.

The final `Verified documented Seamless withdrawal hardening` checkpoint must only be created after the live-schema and browser blockers are resolved and their required checks pass.