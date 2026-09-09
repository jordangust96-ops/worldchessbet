# Seamless Hosted Plaid Launch Handoff

## Current decision

Seamless approved use of its hosted Plaid bank-authorization flow. ChessBet does not need its own Plaid contract, client secret, access token, or processor token. The earlier verified-third-party funding-source design is retired.

The hosted flow costs $1.00 per bank authorization under the executed ACH schedule. Optional Seamless balance and identity checks are not called by this implementation.

## Active player flow

1. ChessBet creates or reuses a Seamless customer and stores the returned `user_id`.
2. The player accepts the versioned ACH authorization and signs with the legal name stored on the account.
3. ChessBet builds the Seamless-hosted URL from the Seamless public key and customer `user_id`.
4. The URL opens in an in-page iframe. Bank credentials and account numbers never enter ChessBet.
5. Browser success is informational only. The account stays ineligible until the authenticated `funding-source.verified` webhook is received.
6. Deposits, withdrawals, and paid contests require the exact verified source and retained webhook evidence. Deposits also require the active ACH authorization bound to that source.

Failure, expiration, and deletion webhooks revoke the bound authorization and downgrade eligibility when no other verified source remains.

## Configuration boundaries

| Setting | Purpose |
| --- | --- |
| `SEAMLESS_ACH_ENV` | Must be `sandbox` or `production`. |
| `SEAMLESS_ACH_PUBLIC_KEY` | Builds the hosted bank URL; safe for the browser. |
| `SEAMLESS_ACH_SECRET_KEY` | Server-only API and webhook authentication. |
| `SEAMLESS_PROVIDER_APPROVED` | Required for money movement and paid contests. |
| `SEAMLESS_DEPOSITS_ENABLED` | Enables ACH debit submissions only when provider approval is also enabled. |
| `SEAMLESS_WITHDRAWALS_ENABLED` | Enables withdrawal submissions only when provider approval is also enabled. |
| `PAID_CONTESTS_ENABLED` | Enables paid contest participation only when provider approval is also enabled. |

Hosted bank verification can be available while money-movement flags remain off.

## Operational checklist

- Confirm the Seamless dashboard has the ChessBet `seamlessAchWebhook` URL configured. Seamless permits one webhook URL per API key.
- Prove `funding-source.verified`, `funding-source.verification-failed`, and `funding-source.verification-expired` delivery in sandbox before a production player journey.
- Confirm no deposit is credited until a Processed transaction webhook posts the ledger.
- Confirm failed and expired bank records show a reconnect action.
- Run `npm run test:seamless`, `npm run test:launch`, and the account-closure/reconciliation checks before release.
- Keep legacy provider records read-only for their retention period; they are not consulted by runtime eligibility or transfer code.
