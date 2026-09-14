# Challenge-first implementation — 2026-09-14

## Non-negotiable invariants
A link is an invitation, not a reservation. Creating, viewing, onboarding,
connecting a bank or starting a deposit never claims a slot or moves contest
funds. Pending ACH and held winnings are never spendable.

New invitations reuse Match with challenge_version=2. They do not reuse the
legacy private accept-then-fund pathway. Existing public matches and historical
financial records retain their lifecycle. New shared challenges are fixed 5+0;
legacy 3/10/15 minute games are not silently reinterpreted.

Creating an invitation does not require a funded wallet. It expires after 24
hours. Up to five open links per creator; links are bearer invitations (any
qualified holder may accept), not identity-restricted invitations.

Before acceptance the creator explicitly enables a 90-second ready window
with match-specific location evidence and disclosed Fair Play/entry/fee
consent. This is not a hold. They can leave or play elsewhere. A fresh locked
check of both players, identity, bank, restrictions, location, active contests
and available balances is mandatory at final acceptance.

A match mutex and sorted shared wallet mutexes serialize acceptance, public
acceptance, cancellation and wallet spending. Both entry amounts and both
fees commit in ONE immutable balanced LedgerJournalBatch. Individual
transactions remain separate and traceable. The match and wallet views are
recoverable projections, not a database multi-record transaction. A lost
response after journal commit must recover the SAME claim, never report a
clean rollback or charge again. Failure before commit leaves funds untouched.

Both players must explicitly ready up after claim; funds alone cannot start
clocks. Readiness is short-lived and refreshed only on explicit user action.
A two-minute no-show window releases both entry amounts and fees with a
single compensating journal. Existing settlement, fair-play, payout holds,
ratings, withdrawal and deposit availability policy remain authoritative.

## Safety / rollout
Checkpoint: fa2a72b2373d06222f8b1c323bb853aa77c2489e.
No production deposits, withdrawals or paid test games are initiated by this
implementation. Use mocked financial and provider adapters for adversarial
tests. Deployment must include affected shared-module callers. Do not delete
historical matches, ledger rows, authorizations, deposits or old schemas.
