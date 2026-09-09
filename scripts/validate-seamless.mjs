import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SEAMLESS_PLAID_PROVIDER_KEY,
  buildBankLinkUrl,
  applyFundingSourceEvent,
  pickSeamlessCustomerId,
} from '../base44/shared/seamlessAchPure.js';
import { isSeamlessPlaidVerified } from '../base44/shared/identityEligibility.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

assert.equal(SEAMLESS_PLAID_PROVIDER_KEY, 'seamless_ach_plaid');
assert.equal(pickSeamlessCustomerId({ user_id: 'customer-top' }), 'customer-top');
assert.equal(pickSeamlessCustomerId({ data: { user_id: 'customer-data' } }), 'customer-data');
assert.equal(pickSeamlessCustomerId({ user: { user_id: 'customer-webhook' } }), 'customer-webhook');
assert.equal(pickSeamlessCustomerId({ result: { customer_id: 'customer-result' } }), 'customer-result');
assert.equal(pickSeamlessCustomerId({}), '');
const link = new URL(buildBankLinkUrl({
  env: 'production',
  publicKey: 'pk_live_example',
  providerUserId: 'usr_example',
  successUrl: 'https://worldchessbet.com/wallet?bank_link=success',
  cancelUrl: 'https://worldchessbet.com/wallet?bank_link=cancelled',
}));
assert.equal(link.origin, 'https://dashboard.seamlesschex.com');
assert.equal(link.hash.startsWith('#/bank-account/pk_live_example/usr_example?'), true);
assert.match(decodeURIComponent(link.hash), /successUrl=https:\/\/worldchessbet\.com\/wallet\?bank_link=success/);
assert.throws(() => buildBankLinkUrl({ env: 'production', publicKey: '', providerUserId: 'usr' }), /PUBLIC_KEY/);

const verifiedUser = {
  account_state: 'verified',
  identity_verification_status: 'verified',
  identity_verification_provider: SEAMLESS_PLAID_PROVIDER_KEY,
  identity_provider_reference: 'source-1',
};
assert.equal(isSeamlessPlaidVerified(verifiedUser), true);
assert.equal(isSeamlessPlaidVerified({ ...verifiedUser, account_state: 'provisional' }), false);
assert.equal(isSeamlessPlaidVerified({ ...verifiedUser, identity_provider_reference: '' }), false);
assert.equal(isSeamlessPlaidVerified({ ...verifiedUser, identity_verification_provider: 'legacy' }), false);

const verified = applyFundingSourceEvent(null, {
  eventType: 'funding-source.verified',
  timestamp: '2026-09-09T12:00:00Z',
});
assert.equal(verified.action, 'apply');
assert.equal(verified.status, 'verified');
const stalePending = applyFundingSourceEvent(
  { status: 'verified', provider_event_at: '2026-09-09T12:00:00Z' },
  { eventType: 'funding-source.pending-verification', timestamp: '2026-09-09T11:00:00Z' }
);
assert.equal(stalePending.action, 'ignore');
assert.equal(stalePending.status, 'verified');
const expired = applyFundingSourceEvent(
  { status: 'verified', provider_event_at: '2026-09-09T12:00:00Z' },
  { eventType: 'funding-source.verification-expired', timestamp: '2026-09-09T13:00:00Z' }
);
assert.equal(expired.status, 'verification_expired');

const [
  panel,
  hostedLink,
  createLink,
  ensureCustomer,
  webhook,
  deposit,
  withdrawal,
  contest,
  retiredManualSource,
  retiredIdentityStart,
] = await Promise.all([
  read('src/components/wallet/SeamlessPlaidBankLink.jsx'),
  read('src/components/wallet/SeamlessFundingPanel.jsx'),
  read('base44/functions/createSeamlessBankLinkUrl/entry.ts'),
  read('base44/functions/ensureSeamlessCustomer/entry.ts'),
  read('base44/functions/seamlessAchWebhook/entry.ts'),
  read('base44/functions/submitSeamlessDeposit/entry.ts'),
  read('base44/functions/submitSeamlessWithdrawal/entry.ts'),
  read('base44/functions/runContestEligibility/entry.ts'),
  read('base44/functions/createVerifiedSeamlessFundingSource/entry.ts'),
  read('base44/functions/startSocureIdentityVerification/entry.ts'),
]);

assert.match(panel, /event\.origin !== providerOrigin/);
assert.match(panel, /event\.source !== iframeRef\.current\?\.contentWindow/);
assert.match(panel, /createSeamlessBankLinkUrl/);
assert.doesNotMatch(panel, /routingNumber|accountNumber|access_token|processor_token/i);
assert.match(hostedLink, /SeamlessPlaidBankLink/);
assert.doesNotMatch(hostedLink, /VerifiedThirdPartyFundingSourceForm/);
assert.match(createLink, /trustedAppOrigin/);
assert.match(createLink, /AchDebitAuthorization\.create/);
assert.match(createLink, /buildBankLinkUrl/);
assert.doesNotMatch(createLink, /SEAMLESS_ACH_SECRET_KEY/);
assert.match(ensureCustomer, /pickSeamlessCustomerId\(data\)/);
assert.ok(webhook.indexOf('verifySeamlessWebhookAuth') < webhook.indexOf('handleFundingSource(base44'));
assert.match(webhook, /'funding-source\.verified'/);
assert.match(webhook, /body\?\.user\?\.user_id/);
assert.match(webhook, /eventType === 'user\.created'/);
assert.match(webhook, /Recovered from authenticated Seamless customer webhook/);
assert.match(webhook, /identity_verification_provider: 'seamless_ach_plaid'/);
assert.match(webhook, /funding_source_id: bank\.source_id/);
assert.ok(
  webhook.indexOf('if (!candidate) return;') <
    webhook.indexOf("identity_verification_status: 'verified'"),
  'an orphan verified source must not activate the player'
);
assert.match(webhook, /const replacement = verifiedBanks\.find/);
assert.match(deposit, /isSeamlessPlaidVerified\(user\)/);
assert.match(withdrawal, /isSeamlessPlaidVerified\(user\)/);
assert.match(contest, /isSeamlessPlaidVerified\(user\)/);
assert.match(retiredManualSource, /status: 410/);
assert.match(retiredIdentityStart, /status: 410/);

for (const source of [panel, hostedLink, createLink, webhook, deposit, withdrawal, contest]) {
  assert.doesNotMatch(source, /Socure|SOCURE|socure/);
}

console.log('Seamless hosted Plaid validation passed.');
