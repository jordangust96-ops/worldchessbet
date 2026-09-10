import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildMerchantBalanceLookupPath,
  mapTransactionStatus,
  PATH_ACCOUNT,
} from '../base44/shared/seamlessAchPure.js';
import { reconcileSeamlessMerchantBalance } from '../base44/shared/seamlessMerchantBalancePure.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

assert.equal(mapTransactionStatus('In Process'), 'pending');
assert.equal(mapTransactionStatus('Processing'), 'pending');
assert.equal(mapTransactionStatus('Processed'), 'completed');
assert.equal(mapTransactionStatus('Returned'), 'reversed');
assert.equal(PATH_ACCOUNT, '/account');
assert.equal(
  buildMerchantBalanceLookupPath('merchant user'),
  '/funding-source/check/balance/:merchant%20user'
);

const shortfall = reconcileSeamlessMerchantBalance({
  providerAvailableBalance: 9,
  providerPendingBalance: 3,
  playerAvailableLiability: 5,
  playerHeldLiability: 5,
  snapshotAsOf: '2026-09-09T00:00:00.000Z',
  calculatedAt: '2026-09-09T00:30:00.000Z',
});
assert.equal(shortfall.status, 'shortfall');
assert.equal(shortfall.settled_coverage_variance, -1);
assert.equal(shortfall.player_ledger_liability, 10);

const [
  transitions,
  releaseSweep,
  statusRecovery,
  webhook,
  withdrawal,
  ledger,
  ledgerRecovery,
  pooled,
  depositWorkflow,
  ledgerWorkflow,
  pooledWorkflow,
  history,
  walletPage,
  depositEmail,
  depositEmailRecovery,
  depositEmailWorkflow,
  emailLogSchema,
] = await Promise.all([
  read('base44/shared/seamlessLedgerTransitions.ts'),
  read('base44/functions/releaseClearedDeposits/entry.ts'),
  read('base44/functions/reconcile-seamless-ach-statuses/entry.ts'),
  read('base44/functions/seamlessAchWebhook/entry.ts'),
  read('base44/functions/submitSeamlessWithdrawal/entry.ts'),
  read('base44/shared/ledger.ts'),
  read('base44/functions/reconcile-ledger-materializations/entry.ts'),
  read('base44/functions/reconcileSeamlessPooledFunds/entry.ts'),
  read('base44/workflows/DepositAvailabilityRelease.jsonc'),
  read('base44/workflows/LedgerMaterializationRecovery.jsonc'),
  read('base44/workflows/HourlySeamlessPooledFundsReconciliation.jsonc'),
  read('src/components/wallet/TransactionHistory.jsx'),
  read('src/pages/WalletPage.jsx'),
  read('base44/shared/depositAvailableEmail.ts'),
  read('base44/functions/processDepositAvailableNotifications/entry.ts'),
  read('base44/workflows/DepositAvailableEmailNotifications.jsonc'),
  read('base44/entities/EmailLog.jsonc'),
]);

assert.match(transitions, /creditHeld: amount/);
assert.match(transitions, /deposit_hold_status: 'held'/);
assert.match(transitions, /ach_return_receivable/);
assert.match(transitions, /withdrawal_fee_refund/);
assert.match(transitions, /withdrawal_hold: true/);
assert.match(releaseSweep, /seamlessRequest\('GET', buildCheckLookupPath\(checkId\)\)/);
assert.match(releaseSweep, /releaseDepositAvailability/);
assert.match(depositWorkflow, /\*\/15 \* \* \* \*/);
assert.match(statusRecovery, /postSeamlessSettlement/);
assert.match(webhook, /reverseSeamlessSettlement/);
assert.match(withdrawal, /triggerEvent: 'withdrawal_fee'/);
assert.doesNotMatch(withdrawal, /hasLedgerGroup/);

assert.match(ledger, /LedgerJournalBatch\.create/);
assert.match(ledger, /legs_json: canonicalLegs/);
assert.ok(ledger.indexOf('LedgerJournalBatch.create') < ledger.indexOf('LedgerEntry.bulkCreate'));
assert.match(ledgerRecovery, /missing_legs_materialized/);
assert.match(ledgerWorkflow, /\*\/5 \* \* \* \*/);

assert.match(pooled, /seamlessRequest\('GET', PATH_ACCOUNT\)/);
assert.match(pooled, /buildMerchantBalanceLookupPath/);
assert.match(pooled, /entities\['seamless-pooled-funds-reconciliation'\]\.create/);
assert.match(pooled, /custody_certification: false/);
assert.match(pooledWorkflow, /7 \* \* \* \*/);

assert.match(history, /heading: "Clearing"/);
assert.match(history, /Withdrawal Fee Refund/);
assert.match(walletPage, />Available</);
assert.match(walletPage, />Clearing</);

assert.match(transitions, /deposit_available_email_status: 'pending'/);
assert.match(releaseSweep, /sendDepositAvailableEmail/);
assert.match(depositEmail, /deposit_hold_status !== 'released'/,
  'email is impossible before funds are actually available');
assert.match(depositEmail, /Amount added/);
assert.match(depositEmail, /Available/);
assert.match(depositEmail, /Submitted/);
assert.match(depositEmail, /Transaction ID/);
assert.match(depositEmail, /Wallet balance/);
assert.match(depositEmail, /Ready to play/);
assert.match(depositEmail, /ctaText: 'Find a Match'/);
assert.match(depositEmail, /claimWebhookEvent\(eventKey, providerLockKey, owner\)/,
  'deposit email delivery is protected by a durable idempotency claim');
assert.match(depositEmail, /finishWebhookEvent\(eventKey, providerLockKey, owner, 'completed'\)/);
assert.match(depositEmailRecovery, /deposit_available_email_status: notificationStatus/);
assert.match(depositEmailRecovery, /MAX_ATTEMPTS = 8/);
assert.match(depositEmailWorkflow, /\*\/5 \* \* \* \*/);
assert.match(emailLogSchema, /"deposit_available"/);

console.log('Financial hardening validation passed.');
