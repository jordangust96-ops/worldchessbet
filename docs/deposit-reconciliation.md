# Deposit fee reconciliation

Fee-priced v2/v3 deposits are reconciled automatically from the saved consent,
a fresh Seamless Processed payment lookup, and the immutable contracted incoming
ACH deduction. Legacy pricing, returned deposits, and every mismatch still require
a Seamless settlement statement or written support confirmation.

## Manual fallback workflow

1. Open Profile > Player & Financial Review > Deposit reconciliation.
2. Select the deposit and use its Seamless payment ID to locate the exact transfer.
3. Record the actual bank debit, actual processor deduction, and actual net
   received from a Seamless statement or written support confirmation. Include
   the statement date/line or support case reference.
4. Confirm that the figures were checked against that source. Only an exact
   match can credit the original wallet principal into clearing. There is no
   mismatch override and no retroactive bank charge.
5. The existing clearing schedule performs a fresh provider status/amount and
   saved-evidence check before release. Missing data and differences keep funds
   unavailable.
6. For a failed or returned deposit, record the actual processing fee retained,
   additional return fee, and their total actual cash cost. Principal reversal
   is separate. These costs are journaled as processor expenses, not silently
   billed to the player or booked as ChessBet fee revenue.

The actual-amount fields start blank. Do not copy the quoted values without
checking the processor evidence. The transaction-level Fee: 0.00 display is
not sufficient evidence. Pending deposits and merchant pooled balances are
not substitutes for a transaction-specific settlement record.

## Automatic v2/v3 settlement path

The documented payment webhook contains status and check ID only:
https://developers-ach.seamlesschex.com/reference/payment-webhooks

The single-payment API is therefore re-read before settlement. Automation requires
an exact provider payment ID, Processed status, gross amount, USD currency when
present, and the immutable `chessbet-deposit-{transactionId}` label. It deliberately
does not interpret `check.fee`, because that field is not the merchant statement
fee. For accepted v2/v3 pricing only, the server applies the contracted incoming
ACH deduction (0.50% + $0.50 using the provider gross-up rule), verifies gross,
fee, net proceeds and payout reserve, then persists immutable evidence with source
`seamless_api_contract`. The provider-level Redis lock serializes webhook and
scheduled-recovery attempts; deterministic ledger group IDs prevent duplicate
money movement.

Any provider, amount, currency, label, pricing, or evidence conflict fails closed
and routes to the existing manual statement/support workflow. Returns always remain
manual because retained processing and return fees are transaction-specific.

## Accounting

For wallet principal P and customer-paid processor fee F:
- Principal settlement: debit settlement P; credit user held P.
- Processor pass-through: debit settlement F, credit processor_fee_clearing F;
  debit processor_fee_clearing F, credit settlement F.
- Across both groups, gross incoming debits are P+F, settlement cash is net P,
  user liability is P, and processor_fee_clearing returns to zero. No platform
  revenue entry is created.
- Availability release changes held/available only.
- A return reverses principal and separately records actual retained processor
  and return costs with matching settlement credits after evidence review.

Journal batches and evidence are immutable. Existing postings are replayed on
interrupted writes; group IDs prevent duplicate money movements. Provider
transaction leases serialize clearing release with webhook/recovery returns.
The status helpers preserve legacy deposits without fee metadata.

## Verification

npm run test:deposit-pricing
npm run test:deposit-reconciliation
npm run test:seamless
npm run test:ledger
npm run test:integration
npm run test:ledger-group-ids
npm run build

The reconciliation tests execute the real review handler, settlement helpers,
and ledger against in-memory data and a mocked processor; no live payments or
financial records are created. They cover missing/incorrect amounts, permission
and evidence checks, retries, release/return races, fees, and crash recovery.
The first live v3 deposit was reconciled on 2026-09-30 against Seamless transaction
10018: $11.16 gross, $0.56 processor deduction, and $10.60 net proceeds. The
provider API/contract automation is covered by mocked no-payment regression tests;
those tests never submit a provider payment.
