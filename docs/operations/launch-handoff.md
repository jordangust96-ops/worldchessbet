# ChessBet launch handoff and operating checklist
Updated 8 September 2026

## Intended launch boundary
ChessBet remains pre-launch. Seamless has not yet approved the Socure output/integration contract. No real money has been accepted, per the owner. Existing payment code is a candidate integration, not evidence of provider acceptance. Do not reinstate Plaid.

## Controls
All flags are server environment names; never place credentials in frontend code.

| Flag | Purpose | Pre-launch | Launch / rollback |
|---|---|---|---|
| SEAMLESS_PROVIDER_APPROVED | Master approval for new provider customers, bank enrollment and transfers | Absent/false | Set true only after final contract implementation and acceptance evidence. Keep true during an ordinary deposit/contest pause so required withdrawals can continue. |
| SEAMLESS_THIRD_PARTY_FUNDING_ENABLED | Bank enrollment and bank screening initiation | false | Enable only for approved Socure-to-Seamless enrollment. |
| SEAMLESS_DEPOSITS_ENABLED | New deposits | Effective false | Enable separately after deposit acceptance; disable to stop new funding. |
| SEAMLESS_WITHDRAWALS_ENABLED | Withdrawals, including closure payout | Effective false | Enable separately after payout acceptance. Do not disable reflexively during a deposit pause. |
| SEAMLESS_RTP_PAYOUTS_ENABLED | Optional RTP | false | Leave off unless separately approved and tested; bank eligibility is also required. |
| PAID_CONTESTS_ENABLED | Creating/joining contests and reserving new Entry Amounts | Absent/false | Enable after full launch acceptance; disable to stop new participation. Existing game completion, settlement, cancellation/refunds, webhook processing and reconciliation remain available. |

Provider approval is a deliberate operational setting, not inferred from credentials being present. Existing direction switches may still be configured true from earlier work; the master approval gate now makes them ineffective until approval. Before granting approval, explicitly set direction switches to the intended staged values so an old true value cannot activate them unexpectedly.

## Checks ready to run
- Run every scripts/validate-*.mjs script. These are offline fixtures/source checks; they do not send provider requests or email.
- npm run lint; npm run typecheck; npm run build; git diff --check.
- getSeamlessOperationalReadiness: admin-only, read-only configuration/Redis diagnostic. It returns readiness_scope=configuration_only. It cannot certify webhook delivery or provider acceptance.
- getLaunchAvailability: public, read-only, no-store projection of effective customer availability.
- Confirm published endpoints, not merely preview. Base44 source auto-sync was insufficient to update existing published functions during this task; the Publish action was necessary.
- Anonymous reconciliation/readiness requests must reject before accessing app records.

## Seamless integration packet needed
Obtain the final accepted workflow/output fields and decision semantics for Socure; exact account-ownership requirements; accepted API request/response examples; callback authentication and event/status schema; idempotency and lookup/reconciliation behavior; pooled-account identity, authoritative cash/balance source and transfer limits; return, reversal and uncertain-outcome procedures. Do not invent a lookup endpoint or treat a local schema/document as provider confirmation.

Map their instructions to:
- base44/shared/seamlessAch.ts and seamlessAchPure.js: transport, endpoints, request/response helpers.
- base44/shared/socure.ts and socureBankEligibility.js: bank-screening request and accepted decision.
- createVerifiedSeamlessFundingSource: authorization/evidence, screening and source creation.
- ensureSeamlessCustomer: identity-eligible customer provisioning.
- submitSeamlessDeposit / submitSeamlessWithdrawal / closeAccount: transfer submission and reservation.
- seamlessAchWebhook / reconcile-seamless-ach-statuses: authenticated settlement and unresolved outcomes.
- record-seamless-merchant-balance-snapshot: pooled cash versus internal liabilities.

Keep provider adapters separate from the internal ledger. Provider submission acceptance must not itself credit available balance. Never change wallet balances directly to make a test pass.

## Acceptance sequence after instructions arrive
1. Save a checkpoint and keep all effective payment/contest switches closed.
2. Implement the confirmed provider mapping; add sanitized real provider fixtures to the existing offline tests.
3. Run build, lint, typecheck and all regressions.
4. Test in a provider-approved environment: identity decision and callback, bank ownership/consent, enrollment, deposit pending/settled/failed/returned, withdrawal reserve/settle/fail/return and closure payout.
5. Exercise duplicates, concurrent requests, delayed/out-of-order callbacks, timeouts after provider acceptance, Redis outage and interrupted persistence. Unknown outcomes must reconcile without blind resubmission.
6. Match every provider operation to the application operation, ledger entries, wallet balances and pooled-funds reconciliation. Record request IDs and redacted evidence.
7. Confirm scheduled jobs execute under the required authorized identity, alert destinations work, and a named operator owns unresolved events.
8. Verify two-player create/join/readiness/game completion/settlement/dispute behavior in an isolated test environment. Offline race models alone are insufficient.
9. Publish the approved revision and verify public endpoints plus desktop/mobile customer flows.
10. Stage provider approval, bank enrollment, payouts, deposits and paid contests only with the applicable acceptance evidence and launch authorization. Start with explicitly limited accounts/amounts agreed with the provider.

## Operations before launch
- Keep a redacted evidence packet with revision, environment, time, test outcomes and provider references.
- Confirm access recovery/MFA, retention/export/restore procedure for ledger and compliance evidence, and scheduled job authorization. A checkpoint restores code, not external cash or database history.
- Confirm fair-play analyzer sustained capacity and timeout behavior using controlled test data. A healthy 512 MB container does not establish load capacity. Infrastructure upgrades require a separate cost decision.
- Rehearse a deposit/contest pause while preserving already-owed money handling, webhook processing and game completion.
- Customer notices now follow server availability; ensure published UI agrees with effective controls.
- Provider instructions, live delivery/settlement proof, operational rehearsals and final launch authorization remain evidence gates; do not describe them as completed because configuration is present.
