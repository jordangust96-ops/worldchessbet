import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSocureIdentityVerified } from '../base44/shared/identityEligibility.js';

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
assert.equal(isSocureIdentityVerified({ ...verifiedSocureUser, identity_verification_status: 'rejected', account_state: 'provisional' }), false, 'rejected is not eligible');
assert.equal(isSocureIdentityVerified({ ...verifiedSocureUser, account_state: 'provisional' }), false, 'account state is required');

const [contest, wager, seamlessDeposit, plaidTransfer, legacyVerify, starter, webhook, userEntity, verificationEntity, earlyAccess, earlyFunding, seamlessCustomer, seamlessLink, seamlessWithdrawal, plaidLink, plaidExchange] =
  await Promise.all([
    readFile(new URL('../base44/functions/runContestEligibility/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/lockWager/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/submitSeamlessDeposit/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/createPlaidTransfer/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/verifyUserIdentity/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/startSocureIdentityVerification/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/socureIdentityWebhook/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/entities/User.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../base44/entities/SocureIdentityVerification.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../base44/shared/earlyAccess.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/shared/earlyAccessFunding.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/ensureSeamlessCustomer/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/createSeamlessBankLinkUrl/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/submitSeamlessWithdrawal/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/createPlaidLinkToken/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../base44/functions/exchangePlaidPublicToken/entry.ts', import.meta.url), 'utf8'),
  ]);

assert.match(earlyAccess, /export const EARLY_ACCESS_MODE = false/, 'Early Access is disabled for production-mode testing');
assert.match(earlyFunding, /if \(!EARLY_ACCESS_MODE\)/, 'new users receive no Early Access funding while production mode is active');
for (const [name, source] of [['contest', contest], ['wager', wager]]) {
  assert.match(source, /if \(!isSocureIdentityVerified\(user\)\)/, `${name} requires an authoritative Socure identity result`);
  assert.doesNotMatch(source, /EARLY_ACCESS_MODE/, `${name} has no Early Access identity bypass`);
}
for (const [name, source] of [['seamless deposit', seamlessDeposit], ['Plaid transfer', plaidTransfer]]) {
  assert.match(source, /!isSocureIdentityVerified\(user\)/, `${name} requires a verified Socure identity result`);
}
for (const [name, source] of [
  ['Seamless customer', seamlessCustomer],
  ['Seamless bank link', seamlessLink],
  ['Seamless withdrawal', seamlessWithdrawal],
  ['Plaid link', plaidLink],
  ['Plaid exchange', plaidExchange],
]) {
  assert.match(source, /isSocureIdentityVerified\(user\)/, `${name} cannot treat a legacy account state as identity verification`);
}
assert.match(legacyVerify, /if\s*\(!EARLY_ACCESS_MODE\)/, 'legacy admin verification cannot promote production users');
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
