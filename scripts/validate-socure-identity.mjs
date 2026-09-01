import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSocureIdentityVerified } from '../base44/shared/identityEligibility.js';
import {
  isSocureBankVerificationAccepted,
  latestSocureBankVerification,
  publicSocureBankStatus,
} from '../base44/shared/socureBankEligibility.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const verifiedSocureUser = {
  account_state: 'verified',
  identity_verification_status: 'verified',
  identity_verification_provider: 'socure',
  identity_provider_reference: 'eval-123',
};

assert.equal(isSocureIdentityVerified(verifiedSocureUser), true, 'accepted Socure result is eligible');
assert.equal(isSocureIdentityVerified({ ...verifiedSocureUser, identity_provider_reference: '' }), false, 'reference is required');
assert.equal(isSocureIdentityVerified({ ...verifiedSocureUser, identity_verification_provider: 'manual_admin' }), false, 'legacy approval is not eligible');
assert.equal(isSocureIdentityVerified({ ...verifiedSocureUser, identity_verification_status: 'pending' }), false, 'pending is not eligible');
assert.equal(isSocureIdentityVerified({ ...verifiedSocureUser, account_state: 'provisional' }), false, 'verified account state is required');

const acceptedBank = { id: 'bank-v1', source_id: 'source-1', status: 'completed', decision: 'ACCEPT', requested_at: '2026-09-01T10:00:00Z' };
assert.equal(isSocureBankVerificationAccepted(acceptedBank, 'source-1'), true, 'accepted screening unlocks only its bound source');
assert.equal(isSocureBankVerificationAccepted(acceptedBank, 'source-2'), false, 'accepted screening cannot unlock another source');
assert.equal(isSocureBankVerificationAccepted({ ...acceptedBank, decision: 'REVIEW' }, 'source-1'), false, 'review remains fail-closed');
assert.equal(isSocureBankVerificationAccepted({ ...acceptedBank, status: 'failed' }, 'source-1'), false, 'failed screening remains fail-closed');
assert.equal(publicSocureBankStatus(acceptedBank), 'verified', 'accepted result exposes a sanitized verified status');
assert.equal(publicSocureBankStatus({ status: 'unknown_outcome', decision: 'UNKNOWN' }), 'review_required', 'unknown provider outcome requires review');
assert.equal(latestSocureBankVerification([
  { ...acceptedBank, id: 'old', requested_at: '2026-08-31T10:00:00Z' },
  { ...acceptedBank, id: 'new', requested_at: '2026-09-01T10:00:00Z' },
], 'source-1').id, 'new', 'latest screening is selected deterministically');

const [contest, wager, deposit, legacyVerify, starter, webhook, userEntity, verificationEntity,
  customer, bankLink, withdrawal, directLink, directExchange, directTransfer, walletProvisioning,
  bankScreen, walletState, fundingPanel] = await Promise.all([
  read('base44/functions/runContestEligibility/entry.ts'),
  read('base44/functions/lockWager/entry.ts'),
  read('base44/functions/submitSeamlessDeposit/entry.ts'),
  read('base44/functions/verifyUserIdentity/entry.ts'),
  read('base44/functions/startSocureIdentityVerification/entry.ts'),
  read('base44/functions/socureIdentityWebhook/entry.ts'),
  read('base44/entities/User.jsonc'),
  read('base44/entities/SocureIdentityVerification.jsonc'),
  read('base44/functions/ensureSeamlessCustomer/entry.ts'),
  read('base44/functions/createSeamlessBankLinkUrl/entry.ts'),
  read('base44/functions/submitSeamlessWithdrawal/entry.ts'),
  read('base44/functions/createPlaidLinkToken/entry.ts'),
  read('base44/functions/exchangePlaidPublicToken/entry.ts'),
  read('base44/functions/createPlaidTransfer/entry.ts'),
  read('base44/shared/walletProvisioning.ts'),
  read('base44/functions/requestSocureBankVerification/entry.ts'),
  read('base44/functions/getSeamlessWalletState/entry.ts'),
  read('src/components/wallet/SeamlessFundingPanel.jsx'),
]);

for (const [name, source] of [['contest', contest], ['wager', wager]]) {
  assert.match(source, /if \(!isSocureIdentityVerified\(user\)\)/, `${name} requires an authoritative Socure identity result`);
}
for (const [name, source] of [['Seamless deposit', deposit], ['Seamless customer', customer], ['Seamless bank link', bankLink], ['Seamless withdrawal', withdrawal]]) {
  assert.match(source, /isSocureIdentityVerified\(user\)/, `${name} requires authoritative Socure identity`);
}
for (const [name, source] of [['direct link', directLink], ['direct exchange', directExchange], ['direct transfer', directTransfer]]) {
  assert.match(source, /status:\s*410/, `${name} is permanently fail-closed`);
  assert.doesNotMatch(source, /fetch\(|plaidClient|seamlessRequest/, `${name} cannot call a provider`);
}
assert.match(legacyVerify, /Socure is authoritative/, 'legacy admin verification cannot promote users');
assert.match(legacyVerify, /requireAdminMfa/, 'legacy admin compatibility route retains MFA');
assert.doesNotMatch(walletProvisioning, /WalletTransaction|postLedgerLegs/, 'wallet provisioning cannot create funds');
assert.match(starter, /status:\s*'expired'/, 'expired pending hosted sessions are recorded');
assert.match(starter, /status:\s*'failed'/, 'provider-start failures are recorded');
assert.match(webhook, /constantTimeEqual/, 'webhook validates its credential in constant time');
assert.match(webhook, /idempotency_key: eventKey/, 'webhook writes a stable idempotency key');
assert.match(webhook, /identity_provider_reference === data\.eval_id/, 'old callbacks cannot overwrite a newer provider result');
assert.match(userEntity, /"identity_verification_provider"/, 'user has a server-maintained provider field');
assert.match(userEntity, /"identity_provider_reference"/, 'user has a server-maintained provider reference');
assert.match(verificationEntity, /"provider_evaluation_id"[\s\S]*?"read": false/, 'provider evaluation ID is not user-readable');
assert.match(verificationEntity, /"reason_codes"[\s\S]*?"read": false/, 'provider reason codes are not user-readable');

assert.doesNotMatch(bankScreen, /requireAdminMfa/, 'bank screening is available to the authenticated owner, not admin-only');
assert.match(bankScreen, /user = await base44\.auth\.me\(\)/, 'bank screening authenticates the caller');
assert.match(bankScreen, /user_id: user\.id,[\s\S]*source_id: sourceId,[\s\S]*status: 'verified'/, 'screening binds to the caller owned verified Seamless source');
assert.match(bankScreen, /normalizedAccount\.endsWith\(mask\)/, 'screening account input must match the Seamless account mask');
assert.doesNotMatch(bankScreen, /account_number:\s*normalizedAccount[\s\S]*SocureBankVerification\.create/, 'raw bank details are not persisted in the verification entity');
assert.match(bankScreen, /verification: publicVerification/, 'responses expose only a sanitized verification record');
assert.match(walletState, /bank_screening_enabled: bankScreeningEnabled/, 'wallet state exposes the server-side Socure availability gate');
assert.match(walletState, /socure_status: publicSocureBankStatus/, 'wallet state exposes only a sanitized bank-screening status');
assert.match(walletState, /source_id: bank\.source_id/, 'wallet can bind screening to the selected Seamless source');
assert.match(deposit, /bank_screening_required/, 'deposits fail closed without accepted Socure bank screening');
assert.ok(deposit.indexOf('bank_screening_required') < deposit.indexOf('claimDepositOperation'), 'deposit screening precedes durable deposit mutation');
assert.match(withdrawal, /bank_screening_required/, 'withdrawals fail closed without accepted Socure bank screening');
assert.ok(withdrawal.indexOf('bank_screening_required') < withdrawal.indexOf('acquireUserWalletLock'), 'withdrawal screening precedes lock and reservation mutation');
assert.match(fundingPanel, /requestSocureBankVerification/, 'wallet invokes Socure bank screening in the user journey');
assert.match(fundingPanel, /ChessBet does not store these numbers/, 'wallet explains memory-only bank detail handling');
assert.match(fundingPanel, /bankScreened/, 'wallet transfer controls require completed screening');

console.log('Socure identity eligibility validation passed.');
