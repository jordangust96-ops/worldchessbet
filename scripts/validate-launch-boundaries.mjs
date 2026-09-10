import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBackend } from './helpers/load-backend.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const configPath = 'base44/shared/seamlessFundingConfig.ts';

const { exports: disabled } = await loadBackend(configPath, {}, {});
assert.equal(disabled.seamlessDepositsEnabled(), false);
assert.equal(disabled.seamlessWithdrawalsEnabled(), false);
assert.equal(disabled.seamlessRtpPayoutsEnabled(), false);
assert.equal(disabled.paidContestsEnabled(), false);
assert.equal(disabled.seamlessHostedPlaidEnabled(), false);

const providerEnv = {
  SEAMLESS_ACH_ENV: 'production',
  SEAMLESS_ACH_PUBLIC_KEY: 'public',
  SEAMLESS_ACH_SECRET_KEY: 'secret',
};
const { exports: verificationOnly } = await loadBackend(configPath, {}, providerEnv);
assert.equal(verificationOnly.seamlessHostedPlaidEnabled(), true,
  'hosted verification may be exposed without enabling money movement');
assert.equal(verificationOnly.seamlessDepositsEnabled(), false);
assert.equal(verificationOnly.seamlessWithdrawalsEnabled(), false);

const enabledEnv = {
  ...providerEnv,
  SEAMLESS_PROVIDER_APPROVED: 'true',
  SEAMLESS_DEPOSITS_ENABLED: 'true',
  SEAMLESS_WITHDRAWALS_ENABLED: 'true',
  SEAMLESS_RTP_PAYOUTS_ENABLED: 'true',
  PAID_CONTESTS_ENABLED: 'true',
};
const { exports: enabled } = await loadBackend(configPath, {}, enabledEnv);
assert.equal(enabled.seamlessHostedPlaidEnabled(), true);
assert.equal(enabled.seamlessDepositsEnabled(), true);
assert.equal(enabled.seamlessWithdrawalsEnabled(), true);
assert.equal(enabled.seamlessRtpPayoutsEnabled(), true);
assert.equal(enabled.paidContestsEnabled(), true);

const { exports: sandboxMoneyMovement } = await loadBackend(configPath, {}, {
  ...enabledEnv,
  SEAMLESS_ACH_ENV: 'sandbox',
});
assert.equal(sandboxMoneyMovement.seamlessHostedPlaidEnabled(), true,
  'sandbox may support hosted bank verification');
assert.equal(sandboxMoneyMovement.seamlessDepositsEnabled(), false,
  'sandbox must never enable production deposits');
assert.equal(sandboxMoneyMovement.seamlessWithdrawalsEnabled(), false,
  'sandbox must never enable production withdrawals');
assert.equal(sandboxMoneyMovement.seamlessRtpPayoutsEnabled(), false,
  'sandbox must never enable production payouts');
assert.equal(sandboxMoneyMovement.paidContestsEnabled(), false,
  'sandbox must never enable paid contests');

for (const [path, predicate] of [
  ['base44/functions/submitSeamlessDeposit/entry.ts', 'seamlessDepositsEnabled'],
  ['base44/functions/submitSeamlessWithdrawal/entry.ts', 'seamlessWithdrawalsEnabled'],
  ['base44/functions/runContestEligibility/entry.ts', 'paidContestsEnabled'],
  ['base44/functions/createSeamlessBankLinkUrl/entry.ts', 'seamlessHostedPlaidEnabled'],
]) {
  const source = await read(path);
  assert.match(source, new RegExp(`if \\(!${predicate}\\(\\)\\)`), `${path} fails closed at its server gate`);
}

const publicPath = 'base44/functions/getLaunchAvailability/entry.ts';
const { handler } = await loadBackend(publicPath, {
  '../../shared/seamlessFundingConfig.ts': verificationOnly,
});
const response = handler();
assert.equal(response.headers.get('Cache-Control'), 'no-store');
assert.deepEqual(await response.json(), {
  paid_contests_enabled: false,
  deposits_enabled: false,
  withdrawals_enabled: false,
  bank_connection_enabled: true,
});

for (const name of ['reconcileIdentityVerification', 'reconcile-seamless-ach-statuses', 'enforceWalletTransactionRetention']) {
  for (const [caller, status] of [[null, 401], [{ role: 'user' }, 403]]) {
    let effects = 0;
    const unexpected = () => { effects += 1; throw new Error('Unexpected privileged access'); };
    const sdk = { auth: { me: async () => caller }, asServiceRole: new Proxy({}, { get: unexpected }) };
    const path = `base44/functions/${name}/entry.ts`;
    const source = await read(path);
    const deps = {};
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
      deps[match[1]] = new Proxy({}, { get: () => unexpected });
    }
    deps['npm:@base44/sdk@0.8.38'] = { createClientFromRequest: () => sdk };
    const { handler } = await loadBackend(path, deps);
    assert.equal((await handler(new Request('https://test.invalid'))).status, status);
    assert.equal(effects, 0);
  }
}

console.log('Launch boundary validation passed.');
