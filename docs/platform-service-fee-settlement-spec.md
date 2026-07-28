# ChessBet Platform Service Fee and Settlement Specification
**Schedule version:** 2026-07-28

## Fixed-dollar fee schedule
| Contest Entry Amount per player | Platform Service Fee per player |
| --- | ---: |
| $5.00-$10.00 | $1.00 |
| $10.01-$25.00 | $2.00 |
| $25.01-$50.00 | $4.00 |
| $50.01-$100.00 | $6.00 |
| $100.01-$250.00 | $10.00 |
| $250.01-$500.00 | $15.00 |
| $500.01-$1,000.00 | $20.00 |
| $1,000.01-$2,500.00 | $30.00 |
| $2,500.01-$5,000.00 | $40.00 |
| Above $5,000 | Manual approval and separately disclosed fee before acceptance |

## Authorization and collection
1. A new contest can be created only from $5.00 through $5,000.00. Amounts above $5,000 are not accepted through the self-service flow.
2. At creation, ChessBet calculates the fixed-dollar fee from the published schedule and snapshots it on the Match as `platform_service_fee` with `platform_fee_schedule_version`.
3. Before a player reserves funds, the player sees the Contest Entry Amount, the separate Platform Service Fee, total amount due, and the Potential Winner Award equal to 100% of combined Contest Entry Amounts.
4. At reservation, the Contest Entry Amount posts separately to `contest_clearing`; the Platform Service Fee posts separately to `suspense`. Each has its own WalletTransaction and balanced ledger group.

## Earning and settlement
- On a valid decisive result, `contest_clearing` pays the full combined Contest Entry Amounts to the winner. No Platform Service Fee is deducted from that award.
- At the same time, each pending fee moves separately from `suspense` to `platform_revenue`.
- ContestRecord stores entry amount, contest pool, total platform fee, per-player fee, and fee-schedule version.

## Refund, reversal, and chargeback
- On a draw, cancellation, platform void, preparation timeout, or another non-decisive result, each affected player’s Contest Entry Amount is released from `contest_clearing` and the separate Platform Service Fee is released from `suspense`.
- These refunds create separate WalletTransaction and ledger entries for entry amount and service fee.
- Any payment reversal, chargeback, or other external-payment exception must be processed as a separate reversal/administrative ledger event. It must not reduce the contest pool or winner award.

## Audit controls
- The fee is never computed as a percentage of the Contest Entry Amount.
- Ledger entries use separate accounts and transaction records for Contest Entry Amounts and Platform Service Fees.
- The match-level fee snapshot ensures a future schedule change cannot alter an already disclosed contest fee.
