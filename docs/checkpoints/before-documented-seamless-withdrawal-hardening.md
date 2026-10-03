# Before documented Seamless withdrawal hardening

Created: 2026-10-03

## Scope
Harden the complete ChessBet Seamless withdrawal flow based on live evidence and current Seamless ACH v2 documentation.

## Safety commitments
- Do NOT invoke any withdrawal/deposit/provider function, workflow, webhook replay, queue processor, or payment endpoint.
- Do NOT retry, cancel, submit, release, or modify any existing WalletTransaction, SeamlessOperation, wallet, ledger, bank-account, or provider record.
  - In particular do not touch pending transaction 6ac0f3837594bd52f0055308 or failed transaction 6abd4f0f079588d83c2b1abd.
- Preserve all existing ledger and idempotency invariants and RLS.

## Documented provider contract
- Seamless Direct Credit is POST /ach/v2/check/send.
- The account field is the SENDER account ID; keep selecting the merchant Seamless Balance source.
- An unverified funding source can receive credits/direct deposits; verification is required only for debits. Therefore recipient status !== verified must not by itself reject a withdrawal.
- Funding-source events: added, updated, verified, deleted, made-primary, pending-verification, verification-failed, verification-expired, bank.account.login.required.
- Payment lifecycle: pending, processing, processed, hold, declined, failed, voided, unpaid, expired.
- Seamless duplicate suppression is time-limited and is not our durable idempotency mechanism.

## Planned corrections
1. Replace coarse withdrawal_destination_changed preflight with precise persisted outcomes (recipient user exists, exactly one current primary destination, belongs to recipient, source_id matches immutable snapshot, not deleted/expired; do not require verified for credit; login-required = distinct hold/review state).
2. Separate definitive failures from transient/indeterminate provider reads (never release funds or describe as rejection for missing/ambiguous/timeout/5xx).
3. Exactly-once submission (persist submitting stage, stable idempotency label, prevent re-entry, capture provider reference on definite success, never auto-POST after ambiguous response; reconcile via GET/provider history).
4. Map provider payment webhook/status states accurately and idempotently.
5. Scheduled read-only reconciliation fallback (query provider history, update only from definitive evidence, never create/retry payout).
6. Correct user/admin messaging (destination changed, bank reconnection required, awaiting review, submitted/processing, bank declined/failed, completed).
7. Preserve no-fee withdrawal behavior and full reserved amount.
8. Comprehensive regression tests.
9. Run focused withdrawal tests, relevant Seamless/ledger tests, npm run build, git diff --check.
10. Create final checkpoint "Verified documented Seamless withdrawal hardening".

## State at checkpoint
No code edits made yet. This checkpoint marks the pre-edit baseline.