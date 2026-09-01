# Deferred pooled account architecture

Status: launch-readiness plan only. Do not implement or enable fund movement until Seamless provides written direction for the Dwolla-backed pooled-bank-account structure.

## Current safe boundary

- `SEAMLESS_DEPOSITS_ENABLED` and `SEAMLESS_WITHDRAWALS_ENABLED` are independent, server-only, fail-closed switches.
- Both switches remain `false` until the corresponding provider flow, custody model, reconciliation, and operational runbook are approved and tested.
- ChessBet's internal double-entry ledger remains the user-balance source of truth; no provider acceptance alone changes an available balance.
- A deposit becomes available only after an authenticated terminal settlement webhook. A withdrawal must reserve internal funds before any provider request.
- No Dwolla customer, beneficial-owner, pooled-account, FBO, virtual-account, or subaccount resource is created by this plan.

## Decisions required from Seamless

1. Identify the legal owner and title of the pooled account and whether it is FBO/omnibus/custodial.
2. Confirm whether each ChessBet player maps to a Dwolla customer, beneficial owner, virtual account, funding source, or only a ChessBet sub-ledger.
3. Define the authoritative identifiers returned to ChessBet and which party owns KYC, sanctions, account verification, and ongoing monitoring.
4. Define deposit and withdrawal settlement timing, available-funds rules, reserves, limits, returns, reversals, disputes, and negative-balance handling.
5. Define statements, reconciliation files/APIs, webhook contracts, retry windows, and operational escalation paths.
6. Confirm account closure, dormant funds, escheatment, and data-retention responsibilities.

## Planned mapping after written approval

Document, then implement, a versioned mapping among:

- ChessBet user id
- ChessBet wallet and internal ledger accounts
- Seamless customer and verified funding-source ids
- Dwolla/customer/FBO identifiers supplied or required by Seamless
- Provider payment/transfer ids and ChessBet integration references

The mapping must contain opaque provider identifiers only?never full routing/account numbers or raw identity payloads.

## Go-live acceptance checklist

- Written provider architecture and account ownership approved by legal/compliance.
- Sandbox customer, bank link, Socure screening, deposit, settlement, return, withdrawal, and failure paths proven end to end.
- Webhook authentication, replay, out-of-order delivery, and reconciliation tested with captured provider fixtures.
- Atomic store and provider reconciliation configured and monitored.
- Deposit and withdrawal switches enabled separately under change control, beginning with limited accounts and limits.
- Operations runbook covers unmatched events, uncertain outcomes, returns, disputes, manual review, and provider outage.

Until every applicable item is complete, transfer switches stay false and provider-specific pooled-account code remains intentionally absent.
