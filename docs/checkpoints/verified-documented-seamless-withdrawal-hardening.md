# Verified documented Seamless withdrawal hardening

Date: 2026-10-03
Baseline: `00e06df^`
Preceded by: `before-documented-seamless-withdrawal-hardening.md` and `documented-seamless-withdrawal-verification-results.md`.

## Final certification

This is the final checkpoint for the documented Seamless withdrawal hardening. All code, schema and message changes are committed, the isolated regression suites pass, the production build passes, and the previously-open blockers are resolved.

### Resolved blockers

1. **Live schema (was the verification-results blocker):** The live deployed `SeamlessBankAccount` schema was read back directly in the authenticated Base44 Data > SeamlessBankAccount > Schema UI by the app owner. The deployed `status` enum visibly includes `added`, `pending_verification`, `verified`, `verification_failed`, `verification_expired`, `login_required`, `deleted`, `error`. The deployed `source_id` description reads "usable for credits/direct deposits regardless of verification status, with verification required only for debits." This matches the checked-in schema in `base44/entities/SeamlessBankAccount.jsonc`. Live-schema equality is therefore certified by owner-confirmed read-back; no SDK schema-write tool was available or used.
2. **Browser withdrawal regression (was the verification-results blocker):** The app owner will perform live browser wallet verification separately. No automated browser regression is claimed here, and the missing Playwright environment is no longer treated as a blocker to this checkpoint.

### Constraints honored this turn

- No live financial or provider function or workflow was invoked.
- Neither protected transaction record was mutated. Their canonical full-record SHA-256 fingerprints were re-read this turn and match the earlier verification reads exactly:

| Transaction | updated_date | status / integration_status | SHA-256 |
| --- | --- | --- | --- |
| 6ac0f3837594bd52f0055308 | 2026-10-03T12:45:51.701000 | failed / failed | 648ad8fec631e5ba83331cf68a659dc4fa54c962b1131f94e79fdf2602ccaeed |
| 6abd4f0f079588d83c2b1abd | 2026-10-02T14:30:57.021000 | failed / failed | 1c731216a2228e3357e14f795b8f5ab791bc4fb4ac3c32f4b7c4a35107a3bfba |

### Carried forward from verification results

- 24 isolated command executions pass; 217,931 completed assertion calls. Exact commands and per-suite counts are recorded in `documented-seamless-withdrawal-verification-results.md`.
- Production build (`npm run build`) exits 0; public prerender of FAQ, About, Fair Play, 3 legal pages, Blog and 45 native article routes completes.
- `git diff --check` and `git diff --check 00e06df^` both exit 0; no whitespace findings across cumulative hardening changes.
- Zero-provider-POST invariants hold across all definitive preflight rejections, indeterminate reads, duplicate requests, read-only reconciliation, scheduler runs and funding-source webhooks.
- No live provider GET endpoints, merchant funding-source responses, lifecycle webhook deliveries, or real payout acceptance/arrival were exercised.

## Cumulative changed files

Relative to `00e06df^`:

1. base44/entities/SeamlessBankAccount.jsonc
2. base44/functions/seamlessAchWebhook/entry.ts
3. base44/functions/submitSeamlessWithdrawal/entry.ts
4. base44/shared/seamlessAchPure.js
5. base44/shared/verifiedWithdrawalBody.ts
6. docs/checkpoints/before-documented-seamless-withdrawal-hardening.md
7. docs/checkpoints/documented-seamless-withdrawal-verification-results.md
8. docs/checkpoints/verified-documented-seamless-withdrawal-hardening.md (this file)
9. scripts/helpers/count-assertions.cjs
10. scripts/helpers/load-backend.mjs
11. scripts/validate-account-closure-payout.mjs
12. scripts/validate-documented-withdrawal-hardening.mjs
13. scripts/validate-funding-journal.mjs
14. scripts/validate-queued-withdrawals.mjs
15. scripts/validate-withdrawal-routing.mjs
16. scripts/validate-withdrawal-no-post-boundaries.mjs
17. src/components/wallet/TransactionHistory.jsx
18. src/components/wallet/transferFailureCopy.js

## Deferred follow-up (owner-owned, not a blocker)

- Live browser wallet verification, performed separately by the app owner.
- Live provider read-back endpoints and real payout acceptance remain intentionally out of scope of this checkpoint; an absent provider payment reference still requires manual/provider reconciliation, never automatic payout retry.

**Checkpoint status: VERIFIED.**