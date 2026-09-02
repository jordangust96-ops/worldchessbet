// Deterministic, no-network verification of the Seamless ACH integration.
// Runs under plain Node (`node scripts/validate-seamless.mjs`) and makes NO
// requests to Seamless. It exercises the pure helpers in
// base44/shared/seamlessAchPure.js end-to-end, and statically asserts the
// deposit-switch / webhook-auth guards exist in the backend function sources
// (matching the style of the existing validate-integration-contract.mjs).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const pure = await import('../base44/shared/seamlessAchPure.js');
const { reconcileSeamlessMerchantBalance } = await import('../base44/shared/seamlessMerchantBalancePure.js');
const {
  formatAmount,
  mapTransactionStatus,
  seamlessBaseUrl,
  buildBankLinkUrl,
  buildCreateCustomerBody,
  buildDepositBody,
  buildWithdrawalBody,
  buildMerchantBalanceTransferBody,
  buildVerifiedThirdPartyFundingSourceBody,
  PATH_VERIFIED_THIRD_PARTY_FUNDING_SOURCE,
  PATH_BALANCE_FROM_ACCOUNT,
  PATH_BALANCE_TO_ACCOUNT,
  constantTimeEqual,
  webhookIdempotencyKey,
  isMerchantBalanceTransaction,
  applyWebhookEvent,
  applyFundingSourceEvent,
  normalizeProviderEventTime,
} = pure;

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// ---------------- Amount formatting ----------------
ok(formatAmount(10) === '10.00', 'formatAmount(10) -> 10.00');
ok(formatAmount(10.5) === '10.50', 'formatAmount(10.5) -> 10.50');
ok(formatAmount(0.1) === '0.10', 'formatAmount(0.1) -> 0.10');
assert.throws(() => formatAmount(0), /Invalid amount/, 'formatAmount(0) throws');
assert.throws(() => formatAmount(-5), /Invalid amount/, 'formatAmount(-5) throws');
assert.throws(() => formatAmount(NaN), /Invalid amount/, 'formatAmount(NaN) throws');
assert.throws(() => formatAmount('abc'), /Invalid amount/, 'formatAmount("abc") throws');

// ---------------- Status mapping ----------------
ok(mapTransactionStatus('Processed') === 'completed', 'Processed -> completed');
for (const s of ['Pending', 'Processing', 'Hold', 'Refund Pending']) {
  ok(mapTransactionStatus(s) === 'pending', `${s} -> pending`);
}
for (const s of ['Failed', 'Declined', 'Voided', 'Unpaid', 'Expired', 'Refund Failed']) {
  ok(mapTransactionStatus(s) === 'failed', `${s} -> failed`);
}
for (const s of ['Refunded', 'Returned', 'Return', 'Reversed']) {
  ok(mapTransactionStatus(s) === 'reversed', `${s} -> reversed`);
}
ok(mapTransactionStatus('SomethingWeird') === 'pending', 'unknown -> pending (never settled)');

// ---------------- Base URL / env ----------------
ok(seamlessBaseUrl('sandbox') === 'https://sandbox.seamlesschex.com/ach/v2', 'sandbox base url');
ok(seamlessBaseUrl('production') === 'https://api.seamlesschex.com/ach/v2', 'production base url');
assert.throws(() => seamlessBaseUrl(''), /SEAMLESS_ACH_ENV/, 'empty env throws');
assert.throws(() => seamlessBaseUrl('staging'), /SEAMLESS_ACH_ENV/, 'bad env throws');

// ---------------- Bank link URL construction ----------------
{
  const url = buildBankLinkUrl({
    env: 'production', publicKey: 'PK123', providerUserId: 'U456',
    successUrl: 'https://app/wallet', cancelUrl: 'https://app/wallet',
  });
  ok(url.startsWith('https://dashboard.seamlesschex.com/ach/#/bank-account/PK123/U456'), 'prod dashboard host + path');
  ok(url.includes('successUrl=https%3A%2F%2Fapp%2Fwallet'), 'successUrl encoded');
  ok(url.includes('cancelUrl='), 'cancelUrl present');
  const surl = buildBankLinkUrl({ env: 'sandbox', publicKey: 'PK', providerUserId: 'U' });
  ok(surl.startsWith('https://sandbox.seamlesschex.com/ach/#/bank-account/'), 'sandbox dashboard host');
  assert.throws(() => buildBankLinkUrl({ env: 'production', providerUserId: 'U' }), /PUBLIC_KEY/, 'missing publicKey throws');
  assert.throws(() => buildBankLinkUrl({ env: 'production', publicKey: 'P' }), /provider user id/, 'missing providerUserId throws');
}

// ---------------- Customer body ----------------
{
  const b = buildCreateCustomerBody({ firstName: 'Jane', lastName: 'Doe', email: 'j@e.com', phone: '555' });
  ok(b.firstName === 'Jane' && b.lastName === 'Doe' && b.email === 'j@e.com' && b.phone === '555', 'customer body includes all fields');
  const min = buildCreateCustomerBody({ firstName: 'Jane', lastName: 'Doe' });
  ok(!('email' in min) && !('phone' in min), 'optional email/phone omitted');
  assert.throws(() => buildCreateCustomerBody({ lastName: 'Doe' }), /firstName/, 'missing firstName throws');
}

// ---------------- Verified third-party funding source ----------------
{
  ok(PATH_VERIFIED_THIRD_PARTY_FUNDING_SOURCE === '/on-demand/funding-source', 'verified source endpoint path');
  const source = buildVerifiedThirdPartyFundingSourceBody({
    providerUserId: 'U123',
    routingNumber: '021000021',
    accountNumber: '123456789',
    accountType: 'checking',
    nickname: 'Primary checking',
  });
  ok(source.user_id === 'U123', 'verified source binds the provider user');
  ok(source.routing_number === '021000021' && source.account_number === '123456789', 'verified source carries bank details only in provider payload');
  ok(source.account_type === 'checking' && source.nickname === 'Primary checking', 'verified source carries account metadata');
  assert.throws(() => buildVerifiedThirdPartyFundingSourceBody({ providerUserId: 'U', routingNumber: '123', accountNumber: '1234', accountType: 'checking' }), /routing/);
  assert.throws(() => buildVerifiedThirdPartyFundingSourceBody({ providerUserId: 'U', routingNumber: '021000021', accountNumber: '12', accountType: 'checking' }), /account number/);
  assert.throws(() => buildVerifiedThirdPartyFundingSourceBody({ providerUserId: 'U', routingNumber: '021000021', accountNumber: '1234', accountType: 'brokerage' }), /checking or savings/);
}

// ---------------- Deposit / withdrawal body construction ----------------
{
  const d = buildDepositBody({ providerUserId: 'U', name: 'Jane', amount: 25, description: 'Fund', label: 'lbl-1' });
  ok(d.sender === 'U', 'deposit sender = provider user id');
  ok(d.amount === '25.00', 'deposit amount formatted');
  ok(d.label === 'lbl-1', 'deposit label carried');
  assert.throws(() => buildDepositBody({ providerUserId: 'U', amount: 1, label: 'l' }), /account holder name/, 'Seamless requires a sender name');
  assert.throws(() => buildDepositBody({ amount: 25, label: 'l' }), /provider user id/, 'deposit missing sender throws');
  assert.throws(() => buildDepositBody({ providerUserId: 'U', name: 'Jane', amount: 25 }), /label/, 'deposit missing label throws');

  const w = buildWithdrawalBody({ providerUserId: 'U', name: 'Jane', amount: 30, description: 'WD', label: 'lbl-2', sourceId: 'SRC-9' });
  ok(w.recipient === 'U', 'withdrawal recipient = provider user id');
  ok(w.account === 'SRC-9', 'withdrawal account = verified source_id');
  ok(w.amount === '30.00', 'withdrawal amount formatted');
  assert.throws(() => buildWithdrawalBody({ providerUserId: 'U', amount: 30, label: 'l' }), /account holder name/, 'Seamless requires a recipient name');
  assert.throws(() => buildWithdrawalBody({ providerUserId: 'U', name: 'Jane', amount: 30, label: 'l' }), /source_id/, 'withdrawal missing sourceId throws');
  assert.throws(() => buildWithdrawalBody({ amount: 30, label: 'l', sourceId: 'S' }), /provider user id/, 'withdrawal missing recipient throws');

  const rtp = buildWithdrawalBody({ providerUserId: 'U', name: 'Jane', amount: 30, label: 'lbl-rtp', sourceId: 'SRC-9', transferSpeed: 'rtp' });
  ok(rtp.transfer_speed === 'rtp', 'RTP is explicit in an eligible payout request');
  ok(!('transfer_speed' in w), 'standard payout leaves provider speed at the existing default');
  assert.throws(() => buildWithdrawalBody({ providerUserId: 'U', name: 'Jane', amount: 30, label: 'l', sourceId: 'S', transferSpeed: 'same_day' }), /unsupported transfer speed/, 'unproven speed is rejected');

  ok(PATH_BALANCE_FROM_ACCOUNT === '/funding-source/add/balance/from-account', 'merchant balance top-up path is modeled');
  ok(PATH_BALANCE_TO_ACCOUNT === '/funding-source/add/balance/to-account', 'merchant balance sweep path is modeled');
  const balanceTransfer = buildMerchantBalanceTransferBody({ sourceId: 'MERCHANT-SRC', amount: 125 });
  ok(balanceTransfer.source_id === 'MERCHANT-SRC' && balanceTransfer.amount === '125.00', 'merchant balance transfer body uses merchant source_id');
}

// ---------------- Merchant pooled-balance reconciliation ----------------
{
  const covered = reconcileSeamlessMerchantBalance({
    providerAvailableBalance: 1200,
    providerPendingBalance: 100,
    playerAvailableLiability: 700,
    playerHeldLiability: 300,
    pendingDepositAmount: 50,
    reservedWithdrawalAmount: 75,
    uncertainWithdrawalAmount: 25,
    snapshotAsOf: '2026-09-01T12:00:00.000Z',
    calculatedAt: '2026-09-01T13:00:00.000Z',
  });
  ok(covered.player_ledger_liability === 1000, 'player liability remains an internal-ledger sum');
  ok(covered.settled_coverage_variance === 200 && covered.status === 'covered', 'merchant pool coverage is calculated separately');
  ok(covered.pending_deposit_amount === 50, 'pending deposits are reported without crediting player liabilities');

  const shortfall = reconcileSeamlessMerchantBalance({
    providerAvailableBalance: 900,
    playerAvailableLiability: 700,
    playerHeldLiability: 300,
    snapshotAsOf: '2026-09-01T12:00:00.000Z',
    calculatedAt: '2026-09-01T13:00:00.000Z',
  });
  ok(shortfall.settled_coverage_variance === -100 && shortfall.status === 'shortfall', 'merchant pool shortfall fails visibly');

  const stale = reconcileSeamlessMerchantBalance({
    providerAvailableBalance: 1000,
    playerAvailableLiability: 1000,
    playerHeldLiability: 0,
    snapshotAsOf: '2026-08-30T00:00:00.000Z',
    calculatedAt: '2026-09-01T13:00:00.000Z',
  });
  ok(stale.status === 'stale_snapshot', 'stale provider balance cannot appear current');
}

// ---------------- Constant-time secret compare (webhook auth) ----------------
ok(constantTimeEqual('secret', 'secret') === true, 'exact secret matches');
ok(constantTimeEqual('secret', 'secre') === false, 'different length rejects');
ok(constantTimeEqual('secret', 'secrex') === false, 'same length different value rejects');
ok(constantTimeEqual('', '') === true, 'empty equals empty');
ok(constantTimeEqual('a', 'b') === false, 'single char differ rejects');

// ---------------- Webhook idempotency key ----------------
{
  const k1 = webhookIdempotencyKey({ eventId: 'evt_123', providerRef: 'X', eventType: 'transaction.status', status: 'Processed', timestamp: 'ts' });
  const k2 = webhookIdempotencyKey({ eventId: 'evt_123', providerRef: 'Y', eventType: 'other', status: 'Failed', timestamp: 'ts2' });
  ok(k1 === k2, 'event_id dominates -> same key (dedupe by event_id)');
  const k3 = webhookIdempotencyKey({ eventId: '', providerRef: 'chk_1', eventType: 'transaction.status', status: 'Processed', timestamp: 't1' });
  const k4 = webhookIdempotencyKey({ eventId: '', providerRef: 'chk_1', eventType: 'transaction.status', status: 'Processed', timestamp: 'retry-timestamp' });
  const k5 = webhookIdempotencyKey({ eventId: '', providerRef: 'chk_1', eventType: 'transaction.status', status: 'Failed', timestamp: 't1' });
  ok(k3 === k4, 'no event_id -> re-timestamped delivery still deduplicates');
  ok(k3 !== k5, 'different status -> different hash (no false dedupe)');
  ok(k3.startsWith('seamless:'), 'idempotency key namespaced');
}


// ---------------- Funding-source lifecycle ----------------
{
  const at1 = '2026-02-19 15:59:10';
  const at2 = '2026-02-19 16:00:10';
  const at3 = '2026-02-19 16:01:10';
  ok(normalizeProviderEventTime(at1) === '2026-02-19T15:59:10.000Z', 'official provider timestamp normalizes');

  const added = applyFundingSourceEvent(null, { eventType: 'funding-source.added', timestamp: at1 });
  ok(added.action === 'apply' && added.status === 'added', 'added event creates added lifecycle state');

  const duplicateAdded = applyFundingSourceEvent(
    { status: 'added', provider_event_at: added.providerEventAt },
    { eventType: 'funding-source.added', timestamp: at1 }
  );
  ok(duplicateAdded.action === 'ignore', 'duplicate added event is harmless');

  const verifiedFirst = applyFundingSourceEvent(null, {
    eventType: 'funding-source.verified', timestamp: at2,
  });
  ok(verifiedFirst.action === 'apply' && verifiedFirst.status === 'verified',
    'verification before added safely creates verified state');

  const duplicateVerified = applyFundingSourceEvent(
    { status: 'verified', provider_event_at: verifiedFirst.providerEventAt },
    { eventType: 'funding-source.verified', timestamp: at2 }
  );
  ok(duplicateVerified.action === 'ignore' && duplicateVerified.status === 'verified',
    'duplicate verification event is harmless');

  const staleAdded = applyFundingSourceEvent(
    { status: 'verified', provider_event_at: verifiedFirst.providerEventAt },
    { eventType: 'funding-source.added', timestamp: at1 }
  );
  ok(staleAdded.action === 'ignore' && staleAdded.status === 'verified',
    'older added event cannot downgrade verified state');

  const removed = applyFundingSourceEvent(
    { status: 'verified', provider_event_at: verifiedFirst.providerEventAt },
    { eventType: 'funding-source.deleted', timestamp: at3 }
  );
  ok(removed.action === 'apply' && removed.status === 'deleted',
    'newer deletion makes a verified bank unavailable');

  const staleVerification = applyFundingSourceEvent(
    { status: 'deleted', provider_event_at: removed.providerEventAt },
    { eventType: 'funding-source.verified', timestamp: at2 }
  );
  ok(staleVerification.action === 'ignore' && staleVerification.status === 'deleted',
    'older verification cannot resurrect a deleted bank');

  const primary = applyFundingSourceEvent(
    { status: 'added', provider_event_at: added.providerEventAt },
    { eventType: 'funding-source.made-primary', timestamp: at2 }
  );
  ok(primary.action === 'metadata' && primary.status === 'added',
    'made-primary never implies verification');

  const legacyDatedAdded = applyFundingSourceEvent(
    { status: 'verified' },
    { eventType: 'funding-source.added', timestamp: at1 }
  );
  ok(legacyDatedAdded.action === 'ignore' && legacyDatedAdded.status === 'verified',
    'dated added replay cannot downgrade a legacy verified row without event timestamp');

  const noTimestampPending = applyFundingSourceEvent(
    { status: 'verified' },
    { eventType: 'funding-source.pending-verification' }
  );
  ok(noTimestampPending.action === 'ignore' && noTimestampPending.status === 'verified',
    'timestamp-less pending replay cannot downgrade verified state');

  const failClosed = applyFundingSourceEvent(
    { status: 'verified' },
    { eventType: 'funding-source.verification-failed' }
  );
  ok(failClosed.action === 'apply' && failClosed.status === 'verification_failed',
    'explicit unavailable event without timestamp fails closed');
}

// ---------------- Merchant balance webhook routing ----------------
const merchantTransfer = {
  event: 'transaction.status',
  check: { description: 'Transfer to Balance', rec_bname: 'Balance', label: null },
};
ok(isMerchantBalanceTransaction(merchantTransfer, 'transaction.status'),
  'unlabeled Transfer to Balance is account-level treasury activity');
ok(isMerchantBalanceTransaction({ check: { sndr_bname: 'Balance', label: '' } }, 'transaction.status'),
  'unlabeled transfer from provider Balance is account-level treasury activity');
ok(!isMerchantBalanceTransaction({ check: { description: 'Transfer to Balance', label: 'chessbet:deposit:1' } }, 'transaction.status'),
  'ChessBet-labeled transaction remains on the player settlement path');
ok(!isMerchantBalanceTransaction(merchantTransfer, 'payment.changed'),
  'non-transaction event is not classified as a merchant balance transaction');

// ---------------- Money state machine (applyWebhookEvent) ----------------
// Exactly-once ledger posting on Processed; no balance change before Processed.
ok(JSON.stringify(applyWebhookEvent({ status: 'pending' }, { status: 'Processed' })) === JSON.stringify({ action: 'post', status: 'completed' }),
  'Processed on pending -> post (settle once)');
ok(applyWebhookEvent({ status: 'completed' }, { status: 'Processed' }).action === 'ignore',
  'Processed on completed -> ignore (exactly-once, no double post)');
ok(applyWebhookEvent({ status: 'pending' }, { status: 'Pending' }).action === 'ignore',
  'Pending -> ignore (NO balance update before Processed)');
ok(applyWebhookEvent({ status: 'pending' }, { status: 'Processing' }).action === 'ignore',
  'Processing -> ignore (no balance update)');
ok(applyWebhookEvent({ status: 'pending' }, { status: 'Hold' }).action === 'ignore',
  'Hold -> ignore (no balance update)');
// Failure handling.
ok(JSON.stringify(applyWebhookEvent({ status: 'pending' }, { status: 'Failed' })) === JSON.stringify({ action: 'fail', status: 'failed' }),
  'Failed on pending -> fail (no ledger change, mark failed)');
ok(applyWebhookEvent({ status: 'pending' }, { status: 'Declined' }).action === 'fail', 'Declined on pending -> fail');
ok(JSON.stringify(applyWebhookEvent({ status: 'completed' }, { status: 'Failed' })) === JSON.stringify({ action: 'reverse', status: 'reversed' }),
  'Failed AFTER Processed -> reverse the prior posting');
ok(JSON.stringify(applyWebhookEvent({ status: 'completed' }, { status: 'Refunded' })) === JSON.stringify({ action: 'reverse', status: 'reversed' }),
  'Refunded after Processed -> reverse');
ok(JSON.stringify(applyWebhookEvent({ status: 'pending' }, { status: 'Refunded' })) === JSON.stringify({ action: 'fail', status: 'reversed' }),
  'Refunded while pending -> fail/reverse (nothing to reverse)');
ok(JSON.stringify(applyWebhookEvent({ status: 'completed' }, { status: 'Returned' })) === JSON.stringify({ action: 'reverse', status: 'reversed' }),
  'Returned after Processed -> reverse');
// Out-of-order: stale Pending after completion must NOT downgrade state.
ok(applyWebhookEvent({ status: 'completed' }, { status: 'Pending' }).action === 'ignore',
  'out-of-order Pending after completed -> ignore (no downgrade)');
ok(applyWebhookEvent({ status: 'failed' }, { status: 'Processed' }).action === 'ignore',
  'out-of-order Processed after failed -> ignore (no resurrection)');

// ---------------- Static guards: deposit-only switch + webhook auth ----------------
const depositSrc = await read('base44/functions/submitSeamlessDeposit/entry.ts');
ok(depositSrc.includes('seamlessDepositsEnabled()'), 'deposit requires the dedicated server-side switch');
ok(depositSrc.indexOf('if (!seamlessDepositsEnabled())') < depositSrc.indexOf('await claimDepositOperation'), 'deposit switch precedes durable mutation');
ok(depositSrc.indexOf('if (!seamlessDepositsEnabled())') < depositSrc.indexOf('data = await seamlessRequest'), 'deposit switch precedes provider request');
ok(depositSrc.includes('isSocureIdentityVerified'), 'deposit retains Socure eligibility');
const withdrawalSrc = await read('base44/functions/submitSeamlessWithdrawal/entry.ts');
ok(withdrawalSrc.includes('seamlessWithdrawalsEnabled()'), 'withdrawal requires its dedicated server-side switch');
ok(withdrawalSrc.indexOf('if (!seamlessWithdrawalsEnabled())') < withdrawalSrc.indexOf('await claimWithdrawalOperation'), 'withdrawal switch precedes durable financial mutation');
ok(withdrawalSrc.includes("bank.rtp_eligible === true ? 'rtp'"), 'RTP requires provider-confirmed bank eligibility');
ok(withdrawalSrc.includes('seamlessRtpPayoutsEnabled()'), 'RTP requires its independent server-side switch');
ok(!withdrawalSrc.includes("transferSpeed: 'rtp'"), 'withdrawal never hard-codes RTP for every payout');
for (const f of ['base44/functions/ensureSeamlessCustomer/entry.ts', 'base44/functions/createSeamlessBankLinkUrl/entry.ts', 'base44/functions/submitSeamlessWithdrawal/entry.ts']) {
  const src = await read(f);
  ok(src.includes('isSocureIdentityVerified'), f + ' retains Socure eligibility');
}

const thirdPartySrc = await read('base44/functions/createVerifiedSeamlessFundingSource/entry.ts');
ok(thirdPartySrc.includes('if (!seamlessThirdPartyFundingEnabled())'), 'third-party enrollment has its own default-off provider approval gate');
ok(thirdPartySrc.indexOf('if (!seamlessThirdPartyFundingEnabled())') < thirdPartySrc.indexOf('SeamlessFundingSourceEnrollment.create'), 'approval gate precedes durable enrollment');
ok(thirdPartySrc.indexOf('evaluateSocureBankAccount') < thirdPartySrc.indexOf("PATH_VERIFIED_THIRD_PARTY_FUNDING_SOURCE"), 'Socure screening precedes Seamless source creation');
ok(thirdPartySrc.includes('consentAccepted === true'), 'enrollment requires explicit consumer consent');
ok(thirdPartySrc.includes('encryptComplianceJson'), 'bank authorization evidence is encrypted before persistence');
ok(thirdPartySrc.includes('providerRequestStarted'), 'unknown provider outcomes are distinguished from local failures');
ok(!/console\.log/.test(thirdPartySrc), 'third-party enrollment never logs bank data');
ok(depositSrc.includes('requireAchAuthorization: true'), 'deposits require retained active ACH authorization');
ok(withdrawalSrc.includes('requireAchAuthorization: false'), 'withdrawals retain KYC evidence without misapplying debit authorization');

const webhookSrc = await read('base44/functions/seamlessAchWebhook/entry.ts');
ok(webhookSrc.includes('verifySeamlessWebhookAuth'), 'webhook verifies Authorization');
ok(webhookSrc.includes('verifySeamlessWebhookAuth'), 'webhook delegates auth to the server-only constant-time verifier');
ok(webhookSrc.includes("status: 401"), 'webhook rejects unauthorized with 401 (non-2xx -> retry)');
ok(webhookSrc.includes('applyWebhookEvent'), 'webhook routes via the money state machine');
ok(webhookSrc.includes('postLedgerLegs'), 'webhook posts through the authoritative ledger helper');
ok(webhookSrc.includes('claimWebhookEvent'), 'webhook atomically claims the event before financial mutation');
ok(webhookSrc.indexOf("eventType === 'endpoint.test'") < webhookSrc.indexOf('claimWebhookEvent(idemKey'),
  'authenticated endpoint probes are acknowledged before financial idempotency');
ok(webhookSrc.includes('isMerchantBalanceTransaction(body, eventType)'),
  'merchant balance transactions bypass player WalletTransaction settlement');
ok(webhookSrc.includes("result: 'merchant_balance_ignored'"),
  'merchant balance transactions are audited and acknowledged');
ok(webhookSrc.includes('pickAmount(body)'), 'unmatched callbacks use only a defined optional amount');
ok(!/console\.log.*authorization/i.test(webhookSrc), 'webhook never logs Authorization');
ok(webhookSrc.includes('body?.customer_id'), 'funding-source ownership reads official customer_id');
ok(webhookSrc.includes('SeamlessPaymentProfile.filter'), 'funding-source ownership resolves through payment profile');
ok(webhookSrc.includes('SeamlessBankAccount.create'), 'identified funding-source event creates missing local bank');
ok(webhookSrc.includes('profiles.length === 1'), 'ambiguous provider customer ownership fails closed');
ok(webhookSrc.includes('awaiting_source_id'), 'source-less pending event waits without guessing a bank');
ok(webhookSrc.includes('source_profile_mismatch'), 'cross-profile source mismatch fails closed and audits');
ok(!webhookSrc.includes("'funding-source.made-primary': 'verified'"), 'made-primary cannot mark a bank verified');
ok(webhookSrc.includes("typeof value === 'boolean'"), 'RTP eligibility accepts only an explicit provider boolean');

const snapshotSchema = JSON.parse(await read('base44/entities/seamless-merchant-balance-snapshot.jsonc'));
const reconciliationSchema = JSON.parse(await read('base44/entities/seamless-pooled-funds-reconciliation.jsonc'));
ok(snapshotSchema.rls.update === false && snapshotSchema.rls.delete === false, 'merchant balance snapshots are immutable');
ok(reconciliationSchema.rls.update === false && reconciliationSchema.rls.delete === false, 'pooled reconciliations are immutable');
const reconciliationSrc = await read('base44/functions/record-seamless-merchant-balance-snapshot/entry.ts');
ok(reconciliationSrc.includes('requireAdminMfa'), 'merchant balance snapshots require administrator MFA');
ok(!reconciliationSrc.includes('seamlessRequest('), 'reconciliation cannot move provider money');

const walletStateSrc = await read('base44/functions/getSeamlessWalletState/entry.ts');
ok(walletStateSrc.includes('identity_verified: isSocureIdentityVerified(user)'), 'wallet state uses full server identity predicate');
ok(!/profile,\s*\n\s*banks,/.test(walletStateSrc), 'wallet state does not return raw provider profile/bank records');

const fundingPanelSrc = await read('src/components/wallet/SeamlessFundingPanel.jsx');
ok(fundingPanelSrc.includes('pollAttempts.current >= 10'), 'wallet polling is bounded');
ok(fundingPanelSrc.includes("const transferDirectionEnabled = direction === 'deposit' ? depositsEnabled : withdrawalsEnabled"), 'funding input follows independent direction switches');
ok(fundingPanelSrc.includes('Verify your identity before adding a funding account.'), 'wallet explains progressive identity gate');
ok(fundingPanelSrc.includes('VerifiedThirdPartyFundingSourceForm'), 'wallet uses ChessBet-owned consent and enrollment');
ok(!fundingPanelSrc.includes('createSeamlessBankLinkUrl'), 'wallet no longer starts the hosted Plaid-style bank link');

// No live Seamless network call should occur in tests; assert the pure module
// has no fetch import (smoke check).
const pureSrc = await read('base44/shared/seamlessAchPure.js');
ok(!pureSrc.includes('fetch('), 'pure helpers make no network calls');

console.log(`Seamless ACH integration verification passed. (${pass} assertions)`);