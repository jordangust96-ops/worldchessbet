import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression test for Finding #3 from the full referential-integrity audit:
// deposit/withdrawal WalletTransactions never recorded which specific
// SeamlessBankAccount (and, when present, which AchDebitAuthorization) was
// actually used to move the money. The only place `source_id` showed up was
// buried inside an unstructured IntegrationReference.metadata_json blob —
// and for deposits, not even there. Meanwhile SeamlessBankAccount.is_primary
// is mutable (createVerifiedSeamlessFundingSource and the Seamless webhook
// both flip it on every re-link), so "look up the user's primary bank
// account" to investigate an old transaction can silently resolve to the
// WRONG account once a user links a second one or replaces their bank.
//
// The fix: WalletTransaction now carries funding_source_id and
// ach_authorization_id, both captured at creation time in all three flows
// that move money to/from a bank (submitSeamlessDeposit,
// submitSeamlessWithdrawal, closeAccount's payout path) — set once, from the
// bank account actually selected for that specific request, never
// re-derived later.

// --- Model: once funding_source_id is captured at creation time, it is
// immune to a later change in which account is_primary. This is the actual
// bug being fixed — demonstrate the before/after difference directly.
function resolveBankAccountForDispute({ transaction, banksByUserId }) {
  // "Before": no funding_source_id on the transaction, so an investigator
  // falls back to whatever is primary today.
  const legacyResolution = transaction.funding_source_id
    ? transaction.funding_source_id
    : (banksByUserId.find((b) => b.is_primary) || banksByUserId[0])?.source_id;
  // "After": the transaction itself says which account was used.
  const fixedResolution = transaction.funding_source_id || null;
  return { legacyResolution, fixedResolution };
}

{
  // The account that funded this specific $500 withdrawal 6 months ago.
  const originalBank = { source_id: 'src_original_checking', is_primary: false }; // no longer primary!
  const newBank = { source_id: 'src_new_savings', is_primary: true }; // user re-linked since then

  const transactionWithoutFix = { funding_source_id: '', amount: 500 };
  const transactionWithFix = { funding_source_id: originalBank.source_id, amount: 500 };
  const currentBanks = [originalBank, newBank];

  const before = resolveBankAccountForDispute({ transaction: transactionWithoutFix, banksByUserId: currentBanks });
  assert.equal(before.legacyResolution, 'src_new_savings', 'without a captured funding_source_id, resolving "the account behind this transaction" today returns the CURRENT primary — the wrong account for a transaction from before the re-link');

  const after = resolveBankAccountForDispute({ transaction: transactionWithFix, banksByUserId: currentBanks });
  assert.equal(after.fixedResolution, 'src_original_checking', 'with funding_source_id captured at creation time, the correct originating account is always recoverable regardless of what is primary today');
}

// --- Cross-check against the actual deployed source.
const [
  walletTxnSchemaSrc, withdrawalSrc, depositSrc, closeAccountSrc, complianceEvidenceSrc,
] = await Promise.all([
  readFile(new URL('../base44/entities/WalletTransaction.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/submitSeamlessWithdrawal/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/submitSeamlessDeposit/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/closeAccount/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/shared/complianceEvidence.ts', import.meta.url), 'utf8'),
]);

assert.match(walletTxnSchemaSrc, /"funding_source_id"/, 'WalletTransaction schema carries a structured funding_source_id field');
assert.match(walletTxnSchemaSrc, /"ach_authorization_id"/, 'WalletTransaction schema carries a structured ach_authorization_id field');

assert.match(complianceEvidenceSrc, /authorization_id: authorization\?\.id \|\| ''/, 'extendComplianceEvidenceRetention returns the resolved authorization id for callers to persist');

// Every one of the three money-movement flows must capture the evidence
// return value AND thread both new fields into its WalletTransaction.create.
for (const [label, src] of [
  ['submitSeamlessWithdrawal', withdrawalSrc],
  ['submitSeamlessDeposit', depositSrc],
  ['closeAccount', closeAccountSrc],
]) {
  assert.match(src, /complianceEvidence = await extendComplianceEvidenceRetention\(/, `${label} captures extendComplianceEvidenceRetention's return value instead of discarding it`);
  assert.match(src, /funding_source_id: bank\.source_id,/, `${label} sets funding_source_id on its WalletTransaction at creation time`);
  assert.match(src, /ach_authorization_id: complianceEvidence\?\.authorization_id \|\| '',/, `${label} sets ach_authorization_id on its WalletTransaction at creation time`);
}

console.log('Funding-source/ACH-authorization traceability validation passed.');
