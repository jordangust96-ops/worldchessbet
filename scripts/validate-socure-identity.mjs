import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSocureIdentityVerified } from '../base44/shared/identityEligibility.js';

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

const [contest, wager, deposit, legacyVerify, starter, webhook, userEntity, verificationEntity,
  customer, bankLink, withdrawal, directLink, directExchange, directTransfer, walletProvisioning] = await Promise.all([
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

console.log('Socure identity eligibility validation passed.');
