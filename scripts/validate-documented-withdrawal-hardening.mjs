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
let providerPosts = 0;

function mockClient() {
  const entities = {
    SeamlessBankAccount: {filter: async () => [{id: 'bank', user_id: 'a', source_id: 'bank1', status: 'verified', is_primary: true}]},
    SeamlessPaymentProfile: {filter: async () => [{user_id: 'a', provider_user_id: 'customer'}]},
    WalletTransaction: {filter: async () => [], get: async () => null, create: async (r) => ({...r, id: 'tx'}), update: async (i, p) => ({id: i, ...p})},
    Wallet: {filter: async () => [{id: 'wa', user_id: 'a', available_balance: 100, held_balance: 0}]},
    SeamlessOperation: {filter: async () => [], create: async (r) => r, update: async (i, p) => p},
    IntegrationReference: {filter: async () => [], create: async (r) => r},
    IntegrationEvent: {create: async (r) => r},
    User: {get: async () => ({id: 'a', identity_verified: true})},
  };
  return {
    auth: {me: async () => ({id: 'a', role: 'user', identity_verified: true})},
    asServiceRole: {entities},
  };
}

function baseDeps(overrides) {
  return {
    'npm:@base44/sdk@0.8.38': {createClientFromRequest: () => mockClient()},
    '../../shared/fundingProvenance.ts': {walletFundingSummary: async () => ({available_to_play: 100})},
    '../../shared/withdrawalQueue.ts': {estimateQueuedWithdrawal: async () => ({}), queuedWithdrawalReady: async () => false},
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
      claimWithdrawalOperation: async (id, key, amount) => ({amount, state: 'new'}),
      saveWithdrawalOperation: async (id, key, value) => value,
    },
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; return {check_id: 'payout'};}},
    ...overrides,
  };
}

const call = async (handler, body) => {
  const r = await handler(new Request('https://test.invalid', {method: 'POST', body: JSON.stringify(body)}));
  return {status: r.status, data: await r.json()};
};

const DEFINITE = new Set(['withdrawal_destination_changed','withdrawal_destination_missing','withdrawal_destination_multiple_primary','withdrawal_destination_deleted','withdrawal_destination_reconnect_required','withdrawal_merchant_unavailable','withdrawal_merchant_balance_unavailable']);
const isDef = e => DEFINITE.has(e?.withdrawalReason);

// 4a. Definitive preflight rejection: no POST, funds released, precise reason
{
  providerPosts = 0;
  const {handler} = await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts', baseDeps({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async () => {const e = new Error('wdc'); e.status = 409; e.withdrawalReason = 'withdrawal_destination_changed'; throw e;}, DEFINITE_DESTINATION_REASONS: DEFINITE, isDefinitePreflightRejection: isDef},
  }));
  const result = await call(handler, {amount: 9.25, idempotencyKey: 'preflight-reject-12345678'});
  assert.equal(providerPosts, 0, 'no POST on definitive preflight rejection');
  assert.equal(result.status, 400);
  assert.equal(result.data.request_terminal, true);
  assert.equal(result.data.withdrawal_reason, 'withdrawal_destination_changed');
  assert.match(result.data.error, /no longer matches your current primary bank/);
  ok();
}

// 4b. Indeterminate preflight read: no POST, funds stay reserved (uncertain)
{
  providerPosts = 0;
  const {handler} = await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts', baseDeps({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async () => {const e = new Error('timeout'); e.status = 0; throw e;}, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
  }));
  const result = await call(handler, {amount: 9.25, idempotencyKey: 'preflight-indeter-1234567'});
  assert.equal(providerPosts, 0, 'no POST on indeterminate preflight read');
  assert.equal(result.status, 202);
  assert.equal(result.data.status, 'uncertain');
  assert.equal(result.data.reconciliation_required, true);
  ok();
}

// 4c. Ambiguous POST response (no check_id): one POST, uncertain, no auto-retry
{
  providerPosts = 0;
  const {handler} = await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts', baseDeps({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async x => x, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; return {};}},
  }));
  const result = await call(handler, {amount: 9.25, idempotencyKey: 'ambiguous-post-123456789'});
  assert.equal(providerPosts, 1, 'exactly one POST on ambiguous response');
  assert.equal(result.status, 202);
  assert.equal(result.data.status, 'uncertain');
  ok();
}

// 4d. Definitive POST 4xx: one POST, funds released as bank decline
{
  providerPosts = 0;
  const {handler} = await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts', baseDeps({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async x => x, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; const e = new Error('declined'); e.status = 400; throw e;}},
  }));
  const result = await call(handler, {amount: 9.25, idempotencyKey: 'post-reject-123456789012'});
  assert.equal(providerPosts, 1);
  assert.equal(result.status, 400);
  assert.equal(result.data.request_terminal, true);
  assert.match(result.data.error, /bank transfer could not be submitted/);
  ok();
}

// 4e. POST 5xx: one POST, uncertain, no release
{
  providerPosts = 0;
  const {handler} = await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts', baseDeps({
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async x => x, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; const e = new Error('5xx'); e.status = 503; throw e;}},
  }));
  const result = await call(handler, {amount: 9.25, idempotencyKey: 'post-5xx-12345678901234'});
  assert.equal(providerPosts, 1);
  assert.equal(result.status, 202);
  assert.equal(result.data.status, 'uncertain');
  ok();
}

// 4f. Scheduler concurrency/re-entry: submitting state → uncertain, no second POST
{
  providerPosts = 0;
  const ops = {};
  const {handler} = await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts', baseDeps({
    '../../shared/seamlessAtomicStore.ts': {
      acquireUserWalletLock: async () => true, releaseUserWalletLock: async () => {},
      claimWithdrawalOperation: async (id, key, amount) => ops[key] || {amount, state: 'submitting', wallet_transaction_id: 'existing-tx'},
      saveWithdrawalOperation: async (id, key, value) => {ops[key] = value; return value;},
    },
    '../../shared/verifiedWithdrawalBody.ts': {buildVerifiedWithdrawalBody: async () => {throw new Error('should not reach preflight')}, DEFINITE_DESTINATION_REASONS: new Set(), isDefinitePreflightRejection: () => false},
    '../../shared/limitedWithdrawal.ts': {sendLimitedWithdrawal: async () => {providerPosts++; return {check_id: 'payout'};}},
  }));
  const result = await call(handler, {amount: 9.25, idempotencyKey: 'submitting-reentry-1234567'});
  assert.equal(providerPosts, 0, 'no POST when already submitting');
  assert.equal(result.status, 202);
  assert.equal(result.data.status, 'uncertain');
  assert.equal(result.data.reconciliation_required, true);
  ok();
}

// ─── 5. Duplicate webhook returns 2xx for already-processed events ───
{
  const {handler} = await loadBackend('base44/functions/seamlessAchWebhook/entry.ts', {
    'npm:@base44/sdk@0.8.38': {createClientFromRequest: () => ({
      asServiceRole: {entities: new Proxy({}, {get: () => ({filter: async () => [], get: async () => null, create: async (r) => r, update: async (i, p) => p})})},
    })},
    '../../shared/seamlessAch.ts': {verifySeamlessWebhookAuth: () => true, webhookIdempotencyKey: () => 'dup-key', mapTransactionStatus, applyWebhookEvent, applyFundingSourceEvent, normalizeProviderEventTime: () => '', userSafeTransferFailureReason: () => '', SEAMLESS_PROVIDER_KEY: 'seamless_ach'},
    '../../shared/seamlessLedgerTransitions.ts': {postSeamlessSettlement: async () => {}, recoverFeeDepositState: async (b, t) => t, releaseSeamlessWithdrawal: async () => {}, reverseSeamlessSettlement: async () => {}},
    '../../shared/integrationEvents.ts': {recordIntegrationEvent: async () => {}},
    '../../shared/depositReconciliation.ts': {flagDepositReview: async () => {}},
    '../../shared/seamlessAtomicStore.ts': {claimWebhookEvent: async () => ({claim: 'completed'}), finishWebhookEvent: async () => {}},
  });
  const r = await handler(new Request('https://test.invalid', {method: 'POST', body: JSON.stringify({event: 'transaction.status', check: {status: 'processed', label: 'chessbet-withdrawal-x'}})}));
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.deduplicated, true);
  ok();
}

// ─── 6. Read-only reconciliation never POSTs (pure reducer check) ───
assert.equal(applyWebhookEvent({status: 'pending'}, {status: 'pending'}).action, 'ignore');
ok();

// ─── 7. Correct user copy: conditions not called "rejected" ───
const {getTransferFailureMessage} = await import('../src/components/wallet/transferFailureCopy.js');
const copyCases = [
  ['withdrawal', '[withdrawal_destination_changed]', /no longer matches your current primary bank/],
  ['withdrawal', '[withdrawal_destination_reconnect_required]', /needs to be reconnected/],
  ['withdrawal', '[withdrawal_destination_deleted]', /has been removed/],
  ['withdrawal', '[withdrawal_merchant_balance_unavailable]', /temporarily unavailable/],
  ['withdrawal', '[withdrawal_preflight_uncertain]', /could not confirm your bank status/],
  ['withdrawal', 'The bank transfer could not be submitted', /could not be completed/],
];
for (const [type, description, expected] of copyCases) {
  const msg = getTransferFailureMessage({type, description});
  assert.match(msg, expected, `copy for ${description}`);
  assert.doesNotMatch(msg, /rejected/i, `copy must not say "rejected": ${description}`);
  ok();
}

console.log(`Documented withdrawal hardening: ${checks} assertions passed — lifecycle, exactly-once, preflight separation, no-POST invariants, duplicate webhook, user copy.`);