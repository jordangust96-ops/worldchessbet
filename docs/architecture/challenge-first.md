# Challenge-first implementation — 2026-09-14

## Product contract
A link is an invitation, not a reservation. Creating, viewing, onboarding,
connecting a bank or starting a deposit never claims a slot or moves contest
funds. Pending ACH, Clearing funds and held winnings are not spendable.

New invitations reuse Match with challenge_version=1 and fixed 5+0 clocks.
Unclaimed invitations normally expire after 24 hours; a creator may have five
open links. Ordinary links are bearer invitations to any qualified holder.
A rematch can be restricted to the previous opponent, derived server-side
from a completed match. A newly created link is shareable without a funded
wallet. An OPEN invitation does not prevent playing another actual contest.

The creator explicitly enables a two-minute acceptance authorization after
agreeing to the disclosed entry, fee and Fair Play terms and completing a
fresh match-location check. This reserves nothing. It prevents an old link
from financially committing an absent creator using stale location evidence.
A funded recipient can request a creator notification without claiming them.

Final acceptance rechecks both players' identity, bank, current policies,
restrictions, available entry plus fee, location evidence, and conflicting
actual contests. Recipient onboarding never changes the invitation status.
Creator location is never inferred from the recipient request's IP.

## Financial commitment and recovery
Match leases and sorted shared wallet leases serialize competing acceptances
and prevent concurrent public/invitation games. Both entries and both fees
commit in one immutable balanced LedgerJournalBatch. WalletTransaction,
LedgerEntry, Wallet and Match are recoverable projections, not a claimed
multi-record database transaction. Entry and fee transactions remain separate.

A lost response after commitment recovers that SAME journal. Durable wallet
barriers prevent other spending against incomplete balance projections.
Barriers stay protected until projection recovery finishes; the operation
remains sweep-visible until both barriers are cleared. No failed eligibility,
view, invitation, or funding-interest click creates a financial transaction.

Both players explicitly ready up AFTER funds are reserved. Readiness remains
fresh for 30 seconds and is renewed only by an already-readied visible device.
Funding alone cannot start clocks. A two-minute start window governs no-shows;
foreground recovery and the existing five-minute PreparationTimeout workflow
release both entries and fees. Offline release can occur after the deadline.
An already-created game resumes without resetting its clock or refunding it.

The existing gameplay, fair-play, settlement, report-window, winnings-release,
ratings, deposit clearance and withdrawal rules remain authoritative. New
invitations do not introduce a second settlement engine or faster funding.

## User and administration surfaces
Play: Challenge Someone first, expandable public Find an Opponent second.
Public /challenge/:code preview preserves the link through account and wallet
setup; /join/:legacy-code is a read-only compatibility tombstone.
Wallet saves nonexclusive invitation context. Deposit-available emails revisit
that invitation when still open and otherwise lead to a new challenge.
Post-game Run It Back creates a new explicitly shared rematch invitation.
Admin /admin/challenges shows status, participant and journal-group traces;
record caps are disclosed. Existing Site Health detects overdue operations.
Terms and Official Rules version 7 describe the new route prospectively;
version 6 records and historical acceptances remain preserved.

## Retired infrastructure
The old private Create/Join/Waiting path cannot accept new invitations.
Legacy one-sided reservation and start entrypoints reject challenge_version=1.
The unused PrivateWaitingCard and initial unused User context fields were
removed. Public matchmaking remains available, with entry-plus-fee checks and
shared participant locks. No historical financial or verification data is deleted.

## Verification and limits
npm run test:challenges executes the actual lifecycle and journal modules
against isolated storage, locks and provider adapters (200 assertions at the
implementation checkpoint). Coverage includes 20 simultaneous acceptances,
unfunded and held-only wallets, identity/bank/hold/location rejection, crash
boundaries, partial barrier cleanup, no-show refunds, explicit readiness,
direct-start refusal, single-game clocks, rematch scope and endpoint redaction.

The pre-change repository was also tested separately from commit
fa2a72b2373d06222f8b1c323bb853aa77c2489e. Its launch-readiness suite already
rejected the deployed Socure identity architecture and its site-activity suite
already failed on an obsolete raw-ESM test harness. Those two pre-existing
failures are not treated as passing or as proof of production readiness.
No real deposits, withdrawals, funded contests or payout changes are executed
as part of these tests. A live two-player money-match smoke test remains a
separate verification step. Source/preview changes are not evidence of a
successful publication to the custom domain.
