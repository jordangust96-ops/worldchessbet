import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
import {buildWithdrawalBody} from '../base44/shared/seamlessAchPure.js';

let merchant, recipient, calls;
const reset=()=>{
  calls=[];
  merchant=[{source_id:'merchant-bank',user_id:'merchant',bank:'Business Bank',status:'verified',is_primary:true},
            {source_id:'merchant-balance',user_id:'merchant',bank:'Balance',status:'verified',is_primary:true}];
  recipient=[{source_id:'recipient-bank',user_id:'recipient',bank:'Recipient Bank',status:'verified',is_primary:true}];
};
reset();

const mockRequest = (recipientResponse) => async (method, path) => {
  calls.push({method, path});
  if (path === '/account') return {user_id: 'merchant'};
  if (path === '/funding-source/user/:merchant') return {success: true, list: merchant};
  if (path === '/funding-source/user/:recipient') return recipientResponse();
  throw Error('Unexpected endpoint');
};

const {exports: {buildVerifiedWithdrawalBody, DEFINITE_DESTINATION_REASONS, isDefinitePreflightRejection}} =
  await loadBackend('base44/shared/verifiedWithdrawalBody.ts', {
    './seamlessAch.ts': {PATH_ACCOUNT: '/account', buildWithdrawalBody, seamlessRequest: mockRequest(() => ({success: true, list: recipient}))}
  });

const input = {providerUserId: 'recipient', sourceId: 'recipient-bank', name: 'Test Player', amount: 9.25, label: 'test-withdrawal'};

// Verified destination succeeds and uses the merchant Balance sender. No POST.
const body = await buildVerifiedWithdrawalBody(input);
assert.equal(body.account, 'merchant-balance');
assert.equal(body.recipient, 'recipient');
assert.equal(body.amount, '9.25');
assert.equal(body.label, input.label);
assert.ok(calls.every(c => c.method === 'GET'), 'preflight must never POST');

// Unverified / pending_verification / added destinations are credit-eligible.
for (const status of ['unverified', 'pending_verification', 'added']) {
  reset(); recipient[0].status = status;
  const ok = await buildVerifiedWithdrawalBody(input);
  assert.equal(ok.account, 'merchant-balance', `${status} should be credit-eligible`);
}

// Definitive rejections — each has a precise, persisted reason.
const rejections = [
  ['source mismatch',         () => recipient[0].source_id = 'different-bank',  'withdrawal_destination_changed'],
  ['no primary',              () => recipient[0].is_primary = false,            'withdrawal_destination_missing'],
  ['wrong owner',            () => recipient[0].user_id = 'someone-else',       'withdrawal_destination_missing'],
  ['multiple primary',        () => recipient.push({...recipient[0], source_id: 'another-primary'}), 'withdrawal_destination_multiple_primary'],
  ['deleted',                () => recipient[0].status = 'deleted',             'withdrawal_destination_deleted'],
  ['verification_expired',   () => recipient[0].status = 'verification_expired', 'withdrawal_destination_reconnect_required'],
  ['login_required',         () => recipient[0].status = 'login_required',      'withdrawal_destination_reconnect_required'],
  ['no balance',             () => merchant.splice(1, 1),                       'withdrawal_merchant_balance_unavailable'],
  ['balance wrong owner',    () => merchant[1].user_id = 'someone-else',         'withdrawal_merchant_balance_unavailable'],
  ['balance deleted',        () => merchant[1].status = 'deleted',               'withdrawal_merchant_balance_unavailable'],
  ['duplicate balance',      () => merchant.push({...merchant[1], source_id: 'another-balance'}), 'withdrawal_merchant_balance_unavailable'],
];
for (const [label, change, expected] of rejections) {
  reset(); change();
  let caught;
  try { await buildVerifiedWithdrawalBody(input); } catch (e) { caught = e; }
  assert.ok(caught, `expected rejection: ${label}`);
  assert.equal(caught.withdrawalReason, expected, `${label}: expected ${expected} got ${caught.withdrawalReason}`);
  assert.ok(DEFINITE_DESTINATION_REASONS.has(caught.withdrawalReason), `${label}: not in DEFINITE_DESTINATION_REASONS`);
  assert.ok(isDefinitePreflightRejection(caught), `${label}: isDefinitePreflightRejection should be true`);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0, `${label}: zero provider POSTs`);
}

// Indeterminate: ambiguous response (success !== true) must not be definitive.
reset();
const {exports: {buildVerifiedWithdrawalBody: buildAmbiguous}} =
  await loadBackend('base44/shared/verifiedWithdrawalBody.ts', {
    './seamlessAch.ts': {PATH_ACCOUNT: '/account', buildWithdrawalBody, seamlessRequest: async (method, path) => {
      calls.push({method, path});
      if (path === '/account') return {user_id: 'merchant'};
      if (path === '/funding-source/user/:merchant') return {success: true, list: merchant};
      return {success: false, list: null};
    }}
  });
let caughtAmbiguous;
try { await buildAmbiguous(input); } catch (e) { caughtAmbiguous = e; }
assert.ok(caughtAmbiguous);
assert.equal(caughtAmbiguous.withdrawalReason, 'withdrawal_sources_unavailable');
assert.equal(isDefinitePreflightRejection(caughtAmbiguous), false, 'ambiguous response must not be definitive');
assert.equal(caughtAmbiguous.withdrawalIndeterminate, true);
assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'ambiguous sources: zero POSTs');

// Indeterminate: raw HTTP error (no withdrawalReason) must not be definitive.
const {exports: {buildVerifiedWithdrawalBody: buildHttpError}} =
  await loadBackend('base44/shared/verifiedWithdrawalBody.ts', {
    './seamlessAch.ts': {PATH_ACCOUNT: '/account', buildWithdrawalBody, seamlessRequest: async (method, path) => {
      calls.push({method, path});
      const e = new Error('timeout'); e.status = 0; throw e;
    }}
  });
let caughtHttp;
try { await buildHttpError(input); } catch (e) { caughtHttp = e; }
assert.ok(caughtHttp);
assert.equal(isDefinitePreflightRejection(caughtHttp), false, 'raw HTTP error must not be definitive');
assert.equal(caughtHttp.withdrawalReason, undefined);
assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'timeout: zero POSTs');

// Missing account identity is an indeterminate read, not merchant rejection.
reset();
const {exports: {buildVerifiedWithdrawalBody: buildMissingAccount}} = await loadBackend('base44/shared/verifiedWithdrawalBody.ts', {
  './seamlessAch.ts': {PATH_ACCOUNT: '/account', buildWithdrawalBody, seamlessRequest: async (method, path) => {calls.push({method, path}); return {};}}
});
await assert.rejects(() => buildMissingAccount(input), e => {
  assert.equal(e.withdrawalReason, 'withdrawal_account_unavailable');
  assert.equal(e.withdrawalIndeterminate, true);
  assert.equal(isDefinitePreflightRejection(e), false);
  return true;
});
assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'missing account identity: zero POSTs');

assert.throws(() => buildWithdrawalBody(input), /merchant sender/);
assert.throws(() => buildWithdrawalBody({...input, senderSourceId: input.sourceId}), /merchant sender/);

console.log('Verified payout routing: credit-eligible unverified, precise persisted outcomes, indeterminate reads never reject, no POST.');