import assert from 'node:assert/strict';
import {
  mapTransactionStatus, applyWebhookEvent, applyFundingSourceEvent,
  STATUS_COMPLETED, STATUS_PENDING, STATUS_FAILED, STATUS_REVERSED,
} from '../base44/shared/seamlessAchPure.js';
import {loadBackend} from './helpers/load-backend.mjs';

let checks = 0;
const ok = () => checks++;

// ─── 1. All payment lifecycle statuses mapped accurately ───
const lifecycle = {
  'processed': STATUS_COMPLETED,
  'pending': STATUS_PENDING, 'processing': STATUS_PENDING, 'hold': STATUS_PENDING,
  'declined': STATUS_FAILED, 'failed': STATUS_FAILED, 'voided': STATUS_FAILED,
  'unpaid': STATUS_FAILED, 'expired': STATUS_FAILED,
  'refunded': STATUS_REVERSED, 'returned': STATUS_REVERSED, 'reversed': STATUS_REVERSED,
  'unknown_status': STATUS_PENDING,
};
for (const [raw, expected] of Object.entries(lifecycle)) {
  assert.equal(mapTransactionStatus(raw), expected, `mapTransactionStatus('${raw}')`);
  ok();
}

// ─── 2. applyWebhookEvent: exactly-once settlement, idempotent duplicates ───
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'processed'}).action, 'post');
assert.equal(applyWebhookEvent({status: 'completed'}, {status: 'processed'}).action, 'ignore');
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'pending'}).action, 'ignore');
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'processing'}).action, 'ignore');
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'hold'}).action, 'ignore');
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'declined'}).action, 'fail');
assert.equal(applyWebhookEvent({status: 'completed'}, {status: 'failed'}).action, 'reverse');
assert.equal(applyWebhookEvent({status: 'completed'}, {status: 'voided'}).action, 'reverse');
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'expired'}).action, 'fail');
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'unpaid'}).action, 'fail');
assert.equal(applyWebhookEvent({status: 'failed'}, {status: 'declined'}).action, 'ignore');
assert.equal(applyWebhookEvent({status: 'reversed'}, {status: 'failed'}).action, 'ignore');
for (let i = 0; i < 12; i++) ok();

// ─── 3. login_required funding-source event ───
assert.equal(applyFundingSourceEvent(null, {eventType: 'bank.account.login.required', timestamp: '2026-10-01T00:00:00Z'}).status, 'login_required');
assert.equal(applyFundingSourceEvent(null, {eventType: 'funding-source.bank.account.login.required', timestamp: '2026-10-01T00:00:00Z'}).status, 'login_required');
assert.equal(applyFundingSourceEvent({status: 'login_required', provider_event_at: '2026-10-01T00:00:00Z'}, {eventType: 'funding-source.added', timestamp: '2026-10-01T00:00:01Z'}).action, 'ignore');
for (let i = 0; i < 3; i++) ok();

// ─── 4. Handler: no provider POST in preflight/review/reconciliation-only cases ───
//
// New withdrawals always enter the queue (the handler returns {status:'queued'}
// before reaching preflight/POST). To exercise preflight/POST in isolation,
// each test issues a user call to create+queue the withdrawal, then an admin
// call with queuedTransactionId to process the queue (queuedWithdrawalReady
// returns true) and reach the separated preflight/POST path.
let providerPosts = 0;

function persistentClient() {
  const store = {
    SeamlessBankAccount: [{id: 'bank', user_id: 'a', source_id: 'bank1', status: 'verified', is_primary: true}],
    SeamlessPaymentProfile: [{user_id: 'a', provider_user_id: 'customer'}],
    WalletTransaction: [],
    Wallet: [{id: 'wa', user_id: 'a', available_balance: 100, held_balance: 0}],
    SeamlessOperation: [],
    IntegrationReference: [],
    User: [{id: 'a', identity_verified: true}],
  };
  let admin = false;
  const matchQ = (row, q) => Object.entries(q || {}).every(([k, v]) => {
    if (v && typeof v === 'object') {
      if (v.$in) return v.$in.includes(row[k]);
      if (v.$gt !== undefined) return row[k] > v.$gt;
    }
    return row[k] === v;
  });
  const entities = new Proxy({}, {get: (_, name) => ({
    filter: async (q, sort, limit) => {
      let rows = (store[name] || []).filter(r => matchQ(r, q));
      if (sort) {
        const desc = sort.startsWith('-'), key = desc ? sort.slice(1) : sort;
        rows = [...rows].sort((a, b) => ((a[key] ?? '') < (b[key] ?? '') ? -1 : (a[key] ?? '') > (b[key] ?? '') ? 1 : 0) * (desc ? -1 : 1));
      }
      return structuredClone(rows.slice(0, limit || 500));
    },
    get: async (id) => structuredClone((store[name] || []).find(r => r.id === id) || null),
    create: async (row) => {
      const next = {created_date: new Date().toISOString(), ...structuredClone(row), id: name + '-' + (store[name] || []).length};
      (store[name] || (store[name] = [])).push(next);
      return structuredClone(next);
    },
    update: async (id, patch) => {
      const row = (store[name] || []).find(r => r.id === id);
      if (row) Object.assign(row, patch);
      return structuredClone(row);
    },
  })});
  return {
    auth: {me: async () => ({id: 'a', role: admin ? 'admin' : 'user', identity_verified: true})},
    asServiceRole: {entities},
    _setAdmin: (v) => { admin = v; },
    _store: store,
  };
}

function baseDeps(ops, overrides) {
  return {
    'npm:@base44/sdk@0.8.38': {createClientFromRequest: () => persistentClient()},
    '../../shared/fundingProvenance.ts': {walletFundingSummary: async () => ({available_to_play: 100})},
    '../../shared/withdrawalQueue.ts': {estimateQueuedWithdrawal: async () => ({}), queuedWithdrawalReady: async () => true},
    '../../shared/queuedWithdrawalFee.ts': {settleQueuedWithdrawalFee: async () => {}},
    '../../shared/withdrawalRequestedEmail.ts': {sendWithdrawalRequestedEmail: async () => ({sent: true})},
    '../../shared/seamlessFundingConfig.ts': {seamlessWithdrawalsEnabled: () => true, seamlessRtpPayoutsEnabled: () => false},
    '../../shared/complianceEvidence.ts': {extendComplianceEvidenceRetention: async () => ({})},
    '../../shared/identityEligibility.js': {hasVerifiedIdentity: async (b, u) => u.identity_verified !== false},
    '../../shared/legalName.ts': {legalNameFromUser: () => ({fullName: 'Test Player'})},
    '../../shared/seamlessAch.ts': {seamlessConfig: () => ({}), seamlessBaseUrl: () => '', buildWithdrawalBody: x => x, PATH_CHECK_SEND: '/send', SEAMLESS_PROVIDER_KEY: 'seamless_ach'},
    '../../shared/ledger.ts': {postLedgerLegs: async () => {}},
    '../../shared/integrationEvents.ts': {recordIntegrationEvent: async () => {}},
    '../../shared/withdrawalLimits.js': {MAX_WITHDRAWAL_AMOUNT: 1100, withdrawalCents: a => Math.round(a * 100)},
    '../../shared/seamlessAtomicStore.ts': {
      acquireUserWalletLock: async () => true, releaseUserWalletLock: async () => {},
      claimWithdrawalOperation: async (id, key, amount) => ops[key] || {amount, state: 'new'},
      saveWithdrawalOperation: async (id, key, value) => {ops[key] = structuredClone(value); return value;},
    },
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; return {check_id: 'payout'};}},
    ...overrides,
  };
}

const DEFINITE = new Set(['withdrawal_destination_changed','withdrawal_destination_missing','withdrawal_destination_multiple_primary','withdrawal_destination_deleted','withdrawal_destination_reconnect_required','withdrawal_merchant_unavailable','withdrawal_merchant_balance_unavailable']);
const isDef = e => DEFINITE.has(e?.withdrawalReason);

// Helper: create+queue a withdrawal (user call), then process the queue
// (admin call) to reach the separated preflight/POST path. Returns the
// admin-call response; providerPosts is reset at entry.
async function readyCall(overrides, key) {
  providerPosts = 0;
  const ops = {};
  const client = persistentClient();
  const {handler} = await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts', baseDeps(ops, {
    'npm:@base44/sdk@0.8.38': {createClientFromRequest: () => client},
    ...overrides,
  }));
  const invoke = async body => {
    const r = await handler(new Request('https://test.invalid', {method: 'POST', body: JSON.stringify(body)}));
    return {status: r.status, data: await r.json()};
  };
  client._setAdmin(false);
  const queued = await invoke({amount: 9.25, idempotencyKey: key});
  assert.equal(queued.status, 200);
  assert.equal(queued.data.status, 'queued');
  assert.equal(providerPosts, 0, 'creating the request never POSTs');
  const txId = client._store.WalletTransaction.find(t => t.type === 'withdrawal').id;
  client._setAdmin(true);
  const result = await invoke({queuedTransactionId: txId});
  return {...result, client, ops, repeat: (extra = {}) => invoke({queuedTransactionId: txId, ...extra})};
}

// 4a. Every definitive outcome: no POST, precise persisted terminal reason.
for (const reason of DEFINITE) {
  const result = await readyCall({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async () => {throw Object.assign(new Error(reason), {status: 409, withdrawalReason: reason});}, DEFINITE_DESTINATION_REASONS: DEFINITE, isDefinitePreflightRejection: isDef},
  }, 'preflight-' + reason);
  assert.equal(providerPosts, 0, 'no POST on ' + reason);
  assert.equal(result.status, 400);
  assert.equal(result.data.request_terminal, true);
  assert.equal(result.data.withdrawal_reason, reason);
  if (reason === 'withdrawal_destination_changed') assert.match(result.data.error, /no longer matches your current primary bank/);
  const tx = result.client._store.WalletTransaction[0];
  assert.equal(tx.status, 'failed');
  assert.match(tx.description, new RegExp(reason));
  const audit = result.client._store.SeamlessOperation[0];
  assert.equal(audit.status, 'released', 'every definitive preflight releases its audit');
  assert.equal(audit.last_error_code, reason);
  assert.equal(audit.last_error_message, result.data.error);
  assert.equal(audit.completed_at, tx.processed_at);
  assert.equal(result.ops[tx.idempotency_key].state, 'released');
  assert.equal(audit.release_ledger_group_id, 'seamless:withdrawal:release:' + tx.id);
  const before = providerPosts;
  await result.repeat();
  assert.equal(providerPosts - before, 0, 'failed request duplicate never POSTs');
  ok();
}

// Not ready remains queued; neither preflight nor provider POST is reached.
{
  let preflightReads = 0;
  const result = await readyCall({
    '../../shared/withdrawalQueue.ts': {estimateQueuedWithdrawal: async () => ({}), queuedWithdrawalReady: async () => false},
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async x => {preflightReads++; return x;}, isDefinitePreflightRejection: isDef},
  }, 'explicit-not-ready-1234567');
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'queued');
  assert.equal(preflightReads, 0);
  assert.equal(providerPosts, 0);
  await result.repeat();
  assert.equal(providerPosts, 0, 'duplicate not-ready scheduler invocation never POSTs');
  ok();
}

// 4b. Indeterminate preflight read: no POST, funds stay reserved (uncertain)
{
  const result = await readyCall({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async () => {const e = new Error('timeout'); e.status = 0; throw e;}, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
  }, 'preflight-indeter-1234567');
  assert.equal(providerPosts, 0, 'no POST on indeterminate preflight read');
  assert.equal(result.status, 202);
  assert.equal(result.data.status, 'uncertain');
  assert.equal(result.data.reconciliation_required, true);
  assert.equal(result.client._store.WalletTransaction[0].integration_status, 'uncertain');
  assert.equal(result.client._store.WalletTransaction[0].withdrawal_request_status, 'review_required');
  const before = providerPosts;
  await result.repeat();
  assert.equal(providerPosts - before, 0, 'indeterminate preflight duplicate never POSTs');
  ok();
}

// 4c. Ambiguous POST response (no check_id): one POST, uncertain, no auto-retry
{
  const result = await readyCall({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async x => x, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; return {};}},
  }, 'ambiguous-post-123456789');
  assert.equal(providerPosts, 1, 'exactly one POST on ambiguous response');
  assert.equal(result.status, 202);
  assert.equal(result.data.status, 'uncertain');
  const before = providerPosts;
  const duplicate = await result.repeat();
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.data.deduplicated, true);
  assert.equal(providerPosts - before, 0, 'duplicate scheduler invocation performs zero additional POSTs');
  assert.equal(result.client._store.WalletTransaction[0].integration_status, 'uncertain');
  ok();
}

// Provider-confirmed controlled retry preserves identity; never automatic.
{
  let attempts = 0;
  const capacityKeys = [];
  const key = 'provider-confirmed-1234567';
  const result = await readyCall({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async x => x, isDefinitePreflightRejection: isDef},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async (b, id, body, options) => {providerPosts++; capacityKeys.push(options.capacityKey); return ++attempts === 1 ? {} : {check_id: 'confirmed-payment'};}},
  }, key);
  assert.equal(result.status, 202);
  // Redis retention loss must recover the ambiguous state from the durable row.
  delete result.ops[key];
  const before = providerPosts;
  assert.equal((await result.repeat()).status, 202);
  assert.equal(providerPosts - before, 0, 'durable uncertain state never automatically retries');
  const tx = result.client._store.WalletTransaction[0];
  assert.equal(tx.status, 'pending');
  assert.equal(tx.withdrawal_request_status, 'review_required');
  const confirmed = await result.repeat({providerNoPaymentConfirmed: true});
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.provider_reference_id, 'confirmed-payment');
  assert.equal(providerPosts, 2, 'only an explicit provider-confirmed retry sends again');
  assert.deepEqual(capacityKeys, [tx.id, tx.id + ':provider-confirmed-retry:1']);
  const sent = providerPosts;
  await result.repeat({providerNoPaymentConfirmed: true});
  assert.equal(providerPosts - sent, 0, 'duplicate authorized retry never sends twice');
  ok();
}

// 4d. Definitive POST 4xx: one POST, funds released as bank decline
{
  const result = await readyCall({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async x => x, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; const e = new Error('declined'); e.status = 400; throw e;}},
  }, 'post-reject-123456789012');
  assert.equal(providerPosts, 1);
  assert.equal(result.status, 400);
  assert.equal(result.data.request_terminal, true);
  assert.match(result.data.error, /bank transfer could not be submitted/);
  ok();
}

// 4e. POST 5xx: one POST, uncertain, no release
{
  const result = await readyCall({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async x => x, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; const e = new Error('5xx'); e.status = 503; throw e;}},
  }, 'post-5xx-12345678901234');
  assert.equal(providerPosts, 1);
  assert.equal(result.status, 202);
  assert.equal(result.data.status, 'uncertain');
  const before = providerPosts;
  const duplicate = await result.repeat();
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.data.deduplicated, true);
  assert.equal(providerPosts - before, 0, 'duplicate scheduler invocation performs zero additional POSTs');
  assert.equal(result.client._store.WalletTransaction[0].integration_status, 'uncertain');
  ok();
}

// 4f. Scheduler concurrency/re-entry: submitting state → uncertain, no second POST
{
  providerPosts = 0;
  const ops = {};
  const client = persistentClient();
  const {handler} = await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts', baseDeps(ops, {
    'npm:@base44/sdk@0.8.38': {createClientFromRequest: () => client},
    '../../shared/seamlessAtomicStore.ts': {
      acquireUserWalletLock: async () => true, releaseUserWalletLock: async () => {},
      claimWithdrawalOperation: async (id, key, amount) => ops[key] || {amount, state: 'submitting', wallet_transaction_id: 'existing-tx'},
      saveWithdrawalOperation: async (id, key, value) => {ops[key] = value; return value;},
    },
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async () => {throw new Error('should not reach preflight')}, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; return {check_id: 'payout'};}},
  }));
  client._setAdmin(false);
  const r = await handler(new Request('https://test.invalid', {method: 'POST', body: JSON.stringify({amount: 9.25, idempotencyKey: 'submitting-reentry-1234567'})}));
  const result = {status: r.status, data: await r.json()};
  assert.equal(providerPosts, 0, 'no POST when already submitting');
  assert.equal(result.status, 202);
  assert.equal(result.data.status, 'uncertain');
  assert.equal(result.data.reconciliation_required, true);
  ok();
}

// ─── 5. Duplicate webhook returns 2xx for already-processed events ───
{
  providerPosts = 0;
  const {handler} = await loadBackend('base44/functions/seamlessAchWebhook/entry.ts', {
    'npm:@base44/sdk@0.8.38': {createClientFromRequest: () => ({
      asServiceRole: {entities: new Proxy({}, {get: () => ({filter: async () => [], get: async () => null, create: async (r) => r, update: async (i, p) => p})})},
    })},
    '../../shared/seamlessAch.ts': {verifySeamlessWebhookAuth: () => true, webhookIdempotencyKey: () => 'dup-key', mapTransactionStatus, applyWebhookEvent, applyFundingSourceEvent, normalizeProviderEventTime: () => '', userSafeTransferFailureReason: () => '', SEAMLESS_PROVIDER_KEY: 'seamless_ach', seamlessRequest: async method => {if (method === 'POST') providerPosts++; return {};}},
    '../../shared/seamlessLedgerTransitions.ts': {postSeamlessSettlement: async () => {}, recoverFeeDepositState: async (b, t) => t, releaseSeamlessWithdrawal: async () => {}, reverseSeamlessSettlement: async () => {}},
    '../../shared/integrationEvents.ts': {recordIntegrationEvent: async () => {}},
    '../../shared/depositReconciliation.ts': {flagDepositReview: async () => {}},
    '../../shared/seamlessAtomicStore.ts': {claimWebhookEvent: async () => ({claim: 'completed'}), finishWebhookEvent: async () => {}},
  });
  const r = await handler(new Request('https://test.invalid', {method: 'POST', body: JSON.stringify({event: 'transaction.status', check: {status: 'processed', label: 'chessbet-withdrawal-x'}})}));
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.deduplicated, true);
  assert.equal(providerPosts, 0, 'duplicate webhook must never POST');
  ok();
}

// ─── 6. Preserve reducer coverage and execute real no-POST boundaries ───
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'pending'}).action, 'ignore');
ok();
await import('./validate-withdrawal-no-post-boundaries.mjs');
await import('./validate-frozen-destination-release.mjs');

// ─── 7. Correct user copy: conditions not called "rejected" ───
const {getTransferFailureMessage} = await import('../src/components/wallet/transferFailureCopy.js');
const copyCases = [
  ['withdrawal', '[withdrawal_destination_changed]', /no longer matches your current primary bank/],
  ['withdrawal', '[withdrawal_destination_reconnect_required]', /needs to be reconnected/],
  ['withdrawal', '[withdrawal_destination_deleted]', /has been removed/],
  ['withdrawal', '[withdrawal_merchant_balance_unavailable]', /temporarily unavailable/],
  ['withdrawal', '[withdrawal_preflight_uncertain]', /could not confirm your bank status/],
  ['withdrawal', 'The bank transfer could not be submitted', /could not be completed/],
  ['deposit', 'NSF', /enough available funds/],
];
for (const [type, description, expected] of copyCases) {
  const msg = getTransferFailureMessage({type, description});
  assert.match(msg, expected, `copy for ${description}`);
  assert.doesNotMatch(msg, /rejected/i, `copy must not say "rejected": ${description}`);
  ok();
}

console.log(`Documented withdrawal hardening: ${checks} scenario groups passed — lifecycle, exactly-once, preflight separation, no-POST invariants, duplicate webhook, user copy.`);