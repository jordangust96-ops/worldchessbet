# Account deletion fulfillment
New requests appear at /admin/account-deletion (Profile > Admin tools). Requests do not close accounts, move funds, cancel games, change eligibility or delete records. The existing Close Account action remains separate and retains all payout checks.

1. Review new requests daily; target completion is within 30 days of request. Explain delays and retained categories to the verified account contact. Do not ask for ID or bank credentials by email.
2. Verify ownership through the authenticated request/account records and an appropriate support verification process.
3. Resolve outstanding contests, balances, transfers, disputes and processor holds using existing authorized controls. Never mark uncertain bank outcomes successful or alter balances directly.
4. Determine which records are legally/contractually required, why, and for how long. Preserve those records and their links. Minimize associated account data not required for retention. This release makes no automatic retention-law determination.
5. Delete non-required associated data using authorized Base44/provider tools. Remove the Base44 app User/authentication record only after the financial/retention review. Review connected providers as applicable. This application does not blindly delete the User entity or related financial/game records.
6. For Sign in with Apple, arrange token revocation through Base44/provider support. If access/refresh tokens are unavailable, follow Apple's TN3194 manual fallback: complete account-data erasure, direct the user to revoke access, and ensure the client returns to signed-out state. Never invent a successful revocation or collect credentials in case notes.
7. Send the player a completion confirmation identifying retained categories, reasons and review/retention dates. Record the fulfillment/confirmation reference without private documents or secrets.
8. In the admin queue, first save In review (or Awaiting settlement), then mark Completed with the retention summary, evidence reference, and confirmed checklist. The server independently requires the Base44 User lookup to return 404; provider/network failures do not count as deletion.

Completion is a manual regulated-service fulfillment workflow, not immediate automatic deletion. Do not represent the request itself as account deletion or App Store approval. No existing accounts are deleted by deployment.
Apple references:
https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple

Fingerprinting: new client calls no longer derive or send a browser fingerprint; requestJurisdiction ignores legacy fingerprint fields. Historical financial/integrity evidence is retained. Identity/age/MFA/IP/jurisdiction and money-flow gates are not weakened.
