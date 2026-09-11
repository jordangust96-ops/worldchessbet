# Deposit fee reconciliation

New fee-priced deposits require a three-way match between the saved consent,
a fresh Seamless payment lookup, and a Seamless settlement statement or written
support confirmation of the actual merchant fee and net proceeds.

## Operator workflow

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

## Why statement verification is currently required

The documented payment webhook contains status and check ID only:
https://developers-ach.seamlesschex.com/reference/payment-webhooks

The documented single-payment response provides check.amount and check.fee,
but does not establish that check.fee includes merchant/account-level processing
deductions or expose an unambiguous final net-settlement amount:
https://developers-ach.seamlesschex.com/reference/retrieve-single-payment

Therefore automatic approval from those fields is deliberately unavailable.
An automatic statement feed can replace administrator evidence only after the
provider supplies and confirms the relevant schema and meanings.

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
A real newly priced deposit has not yet been verified through settlement.
