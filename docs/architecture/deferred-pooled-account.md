# Seamless/Dwolla pooled-funds architecture

Status: implemented for publish readiness. Seamless holds provider cash at the merchant-pool level while ChessBet's internal double-entry ledger remains the authoritative per-player subledger. Money movement remains independently gated until runtime configuration and end-to-end provider tests pass.

## Current safe boundary

- `SEAMLESS_DEPOSITS_ENABLED` and `SEAMLESS_WITHDRAWALS_ENABLED` are independent, server-only, fail-closed switches.
- Each switch may be enabled only after its runtime configuration, webhook, reconciliation, and end-to-end provider test passes.
- ChessBet's internal double-entry ledger remains the user-balance source of truth; no provider acceptance alone changes an available balance.
- A deposit becomes available only after an authenticated terminal settlement webhook. A withdrawal must reserve internal funds before any provider request.
- ChessBet does not fabricate per-player Dwolla/FBO accounts. Provider-level pooled cash is reconciled against the sum of internal player wallet liabilities.

## Confirmed operating model and ongoing provider controls

1. Identify the legal owner and title of the pooled account and whether it is FBO/omnibus/custodial.
2. Confirm whether each ChessBet player maps to a Dwolla customer, beneficial owner, virtual account, funding source, or only a ChessBet sub-ledger.
3. Define the authoritative identifiers returned to ChessBet and which party owns KYC, sanctions, account verification, and ongoing monitoring.
4. Define deposit and withdrawal settlement timing, available-funds rules, reserves, limits, returns, reversals, disputes, and negative-balance handling.
5. Define statements, reconciliation files/APIs, webhook contracts, retry windows, and operational escalation paths.
6. Confirm account closure, dormant funds, escheatment, and data-retention responsibilities.

## Implemented identifier mapping

The versioned integration mapping covers:

- ChessBet user id
- ChessBet wallet and internal ledger accounts
- Seamless customer and verified funding-source ids
- Dwolla/customer/FBO identifiers supplied or required by Seamless
- Provider payment/transfer ids and ChessBet integration references

The mapping contains opaque provider identifiers only and never full routing/account numbers or raw identity payloads.

## Go-live acceptance checklist

- Written provider architecture and account ownership approved by legal/compliance.
- Sandbox customer, bank link, Socure screening, deposit, settlement, return, withdrawal, and failure paths proven end to end.
- Webhook authentication, replay, out-of-order delivery, and reconciliation tested with captured provider fixtures.
- Atomic store and provider reconciliation configured and monitored.
- Deposit and withdrawal switches enabled separately under change control, beginning with limited accounts and limits.
- Operations runbook covers unmatched events, uncertain outcomes, returns, disputes, manual review, and provider outage.

Transfer switches stay fail-closed until their applicable runtime and provider acceptance checks pass. The implemented pooled-funds reconciliation is operationally separate from transfer execution.
