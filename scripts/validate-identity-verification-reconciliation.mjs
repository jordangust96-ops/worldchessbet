import assert from 'node:assert/strict';
import { loadBackend } from './helpers/load-backend.mjs';

const user = {
  id: 'u1',
  identity_verification_provider: 'seamless_ach_plaid',
  identity_provider_reference: 'source-1',
  identity_verification_status: 'verified',
  account_state: 'verified',
  identity_verified_at: '2026-09-09T12:00:00Z',
};
const source = {
  id: 'bank-1',
  user_id: 'u1',
  source_id: 'source-1',
  status: 'verified',
  verified_at: '2026-09-09T12:00:00Z',
  last_provider_event_id: 'event-1',
  provider_user_id: 'provider-user-1',
};
const authorization = {
  id: 'authorization-1',
  user_id: 'u1',
  provider_key: 'seamless_ach_plaid',
  provider_user_id: 'provider-user-1',
  funding_source_id: 'source-1',
  provider_event_id: 'event-1',
  status: 'active',
};

async function run(caller, currentUser = user, currentSource = source, currentAuthorization = authorization) {
  const updates = [], flags = [], events = [], reads = [];
  const sdk = {
    auth: { me: async () => caller },
    asServiceRole: { entities: {
      User: {
        filter: async () => { reads.push('users'); return [currentUser]; },
        update: async (_id, value) => { updates.push(value); return { ...currentUser, ...value }; },
      },
      SeamlessBankAccount: {
        filter: async (query) => {
          assert.equal(query.user_id, currentUser.id);
          assert.equal(query.source_id, currentUser.identity_provider_reference);
          return currentSource ? [currentSource] : [];
        },
      },
      AchDebitAuthorization: {
        filter: async (query) => {
          assert.equal(query.user_id, currentUser.id);
          assert.equal(query.funding_source_id, currentUser.identity_provider_reference);
          assert.equal(query.status, 'active');
          return currentAuthorization ? [currentAuthorization] : [];
        },
      },
      IntegrationEvent: { create: async (value) => events.push(value) },
      IntegrityFlag: { create: async (value) => flags.push(value) },
    } },
  };
  const { handler } = await loadBackend(
    'base44/functions/reconcileIdentityVerification/entry.ts',
    { 'npm:@base44/sdk@0.8.38': { createClientFromRequest: () => sdk } }
  );
  const response = await handler(new Request('https://test.invalid', { method: 'POST', body: '{}' }));
  return { status: response.status, updates, flags, events, reads };
}

for (const [caller, status] of [[null, 401], [{ role: 'user' }, 403]]) {
  const result = await run(caller);
  assert.equal(result.status, status);
  assert.equal(result.reads.length, 0);
}

const admin = { role: 'admin' };
assert.equal((await run(admin)).updates.length, 0, 'trusted matching snapshot remains unchanged');

const missingAuthorization = await run(admin, user, source, null);
assert.equal(missingAuthorization.updates[0].account_state, 'provisional');
assert.equal(missingAuthorization.updates[0].identity_verification_status, 'review_required');
assert.equal(missingAuthorization.flags.length, 1);

for (const invalidSource of [
  null,
  { ...source, status: 'verification_failed' },
  { ...source, status: 'verification_expired' },
  { ...source, status: 'verified', verified_at: '' },
  { ...source, status: 'verified', last_provider_event_id: '' },
]) {
  const result = await run(admin, user, invalidSource);
  assert.equal(result.updates[0].account_state, 'provisional');
  assert.notEqual(result.updates[0].identity_verification_status, 'verified');
  assert.equal(result.flags.length, 1);
}

const provisional = {
  ...user,
  identity_verification_status: 'pending',
  account_state: 'provisional',
  identity_verified_at: '',
};
const promoted = await run(admin, provisional, source);
assert.equal(promoted.updates[0].account_state, 'verified');
assert.equal(promoted.updates[0].identity_verification_status, 'verified');
assert.equal(promoted.events.length, 1);

for (const state of ['suspended', 'closed']) {
  const result = await run(admin, { ...provisional, account_state: state }, source);
  assert.equal(result.updates[0].account_state, state, 'provider success preserves restrictions');
}

console.log('Hosted bank reconciliation checks passed.');
