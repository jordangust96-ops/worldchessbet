# ChessBet Funds-Flow Integration Contract

Version: 1  
Provider status: Seamless (`seamless_ach`) is the selected funds-movement partner (deposits, withdrawals, verified third-party funding source); Socure (`socure`) is the selected identity-verification and bank-screening partner. `unassigned` remains a valid `provider_key` value only for a reference type not yet routed to any partner.

This contract is the stable boundary between ChessBet's internal contest/ledger system and any future payment processor, funds-flow platform, sponsor bank, custody provider, or payout rail. Provider-specific IDs and payloads must never replace ChessBet's canonical IDs.

## Canonical identifiers

| Concept | Canonical source | Contract field |
|---|---|---|
| Player | `User.id` | `player_id` / `user_id` |
| Wallet | `Wallet.id` | `wallet_id` |
| User-facing transaction | `WalletTransaction.id` | `wallet_transaction_id` / `transaction_id` |
| Balanced ledger posting | `LedgerEntry.ledger_group_id` | `ledger_group_id` |
| Contest | `Match.id` | `match_id` |
| Chess game | `Game.id` | `game_id` |
| Permanent contest result | `ContestRecord.id` | `contest_record_id` |
| Player report / investigation | `DisputeCase.id` | `dispute_case_id` |
| Integration lifecycle event | `IntegrationEvent.id` | `integration_event_id` |
| External partner object | `IntegrationReference.id` | `integration_reference_id` |

Built-in Base44 IDs are opaque strings. They are never parsed for business meaning and never reused across entity types.

## Correlation rules

1. Contest-related activity uses `Match.id` as `correlation_id`.
2. Standalone funding or withdrawal activity uses `WalletTransaction.id` as `correlation_id`.
3. A balanced posting uses one `ledger_group_id` across every debit and credit leg.
4. Every LedgerEntry records its WalletTransaction, Match, Game (when available), correlation ID, currency, and schema version.
5. Every new WalletTransaction is normalized after its balanced ledger posting with direction, source event, ledger group, correlation ID, processing time, integration status, idempotency key, currency, and schema version.
6. Historical rows are normalized at export time without mutating immutable LedgerEntry or ContestRecord history.

## Integration outbox

`IntegrationEvent` is the provider-neutral event outbox. It is admin-only and does not affect gameplay, clocks, balances, outcomes, settlement, disputes, or enforcement.

Current event families:

- `contest.created`
- `contest.accepted`
- `contest.fair_play_certified`
- `contest.participant_funded`
- `contest.started`
- `contest.cancelled`
- `contest.settled`
- `financial.<source_event>`
- `dispute.opened`
- `dispute.<admin_action>`

Events begin with `delivery_state = unconfigured`. Selecting a partner will add an adapter that reads these events, creates provider requests with the event's `idempotency_key`, writes mappings to `IntegrationReference`, and updates delivery state. Until then, no event is sent externally.

Event creation is deliberately non-blocking. Authoritative Match, Game, WalletTransaction, LedgerEntry, ContestRecord, and DisputeCase writes always take precedence. An outbox failure is logged with sanitized identifiers and must never cause a financial request to be retried after money already moved.

## External references

`IntegrationReference` is the only provider-ID mapping table. It supports participants, customers, accounts, wallets, funding sources, authorizations, payments, transfers, payouts, refunds, reversals, disputes, webhook events, and future reference types.

Rules:

- Store the partner name in `provider_key` (currently `seamless_ach` or `socure`); use `unassigned` only for a reference type not yet routed to a partner.
- Store only opaque provider IDs and sanitized metadata.
- Never store API credentials, bank credentials, full payment instruments, raw identity documents, or unrestricted webhook payloads.
- Preserve ChessBet's canonical internal ID even if a provider object is replaced or migrated.
- Webhook handlers must deduplicate on provider webhook-event ID and map back through this table.

## Transaction directions

| WalletTransaction type | Direction |
|---|---|
| deposit | credit |
| withdrawal | debit |
| wager_lock | reserve |
| wager_refund | release |
| payout | credit |
| service_fee_charge | reserve |
| service_fee_refund | release |
| withdrawal_fee | debit |

Currency is currently `USD` and is explicit on all new integration records.

## Adapter packet

The admin-only `getIntegrationPacket` backend function accepts one of:

- `matchId`
- `transactionId`
- `userId`
- `caseId`

It returns a versioned packet containing canonical IDs, contest/result facts, normalized WalletTransactions, immutable LedgerEntries, balanced-group diagnostics, outbox events, provider mappings, and dispute/hold state. It intentionally excludes email addresses, raw identity records, credentials, payment instruments, PGN/move telemetry, and unrestricted internal notes.

Future partner adapters should consume this packet or its underlying entities. They must not recalculate contest outcomes, fees, or balances.

## Source-of-truth hierarchy

1. Game: authoritative chess result and end reason.
2. Match: authoritative contest lifecycle and participant IDs.
3. LedgerEntry: immutable financial accounting legs.
4. WalletTransaction: participant-facing transaction summary.
5. ContestRecord: immutable settled-contest snapshot.
6. DisputeCase / CaseResolution: formal report, hold, and post-contest administrative outcome.
7. IntegrationEvent / IntegrationReference: delivery and mapping layer only.

Provider acknowledgements and webhooks may update integration delivery/mapping state, but may not directly edit a Match result, Game result, Wallet balance, immutable LedgerEntry, or immutable ContestRecord.
