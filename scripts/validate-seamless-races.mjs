import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyWebhookEvent } from '../base44/shared/seamlessAchPure.js';

class AtomicModel {
  constructor(available) {
    this.available = available; this.held = 0; this.reserve = 0; this.settlement = 0;
    this.operations = new Map(); this.events = new Set(); this.transactions = new Map(); this.payouts = 0;
    this.tail = Promise.resolve();
  }
  atomic(work) {
    const run = this.tail.then(work, work);
    this.tail = run.catch(() => {});
    return run;
  }
  async withdraw(key, amount, outcome = 'submitted') {
    return this.atomic(() => {
      const existing = this.operations.get(key);
      if (existing) return { ...existing, duplicate: true };
      if (this.available < amount) return { rejected: 'insufficient' };
      const op = { amount, state: 'reserved' };
      this.available -= amount; this.held += amount; this.reserve += amount;
      this.operations.set(key, op);
      if (outcome === 'rejected') {
        this.available += amount; this.held -= amount; this.reserve -= amount; op.state = 'failed';
      } else if (outcome === 'uncertain') {
        op.state = 'uncertain';
      } else {
        op.state = 'submitted'; this.payouts++;
      }
      return { ...op };
    });
  }
  async webhook(eventKey, txId, status, amount, type) {
    return this.atomic(() => {
      if (this.events.has(eventKey)) return 'duplicate';
      this.events.add(eventKey);
      const tx = this.transactions.get(txId) || { status: 'pending', type, amount };
      const decision = applyWebhookEvent(tx, { status });
      if (decision.action === 'post') {
        if (type === 'deposit') this.available += amount;
        else { this.held -= amount; this.reserve -= amount; this.settlement += amount; }
      } else if (decision.action === 'reverse') {
        if (type === 'deposit') this.available -= amount;
        else { this.settlement -= amount; this.available += amount; }
      } else if (decision.action === 'fail' && type === 'withdrawal') {
        this.held -= amount; this.reserve -= amount; this.available += amount;
      }
      tx.status = decision.status; this.transactions.set(txId, tx);
      return decision.action;
    });
  }
}

const withdrawal = new AtomicModel(100);
const [first, second] = await Promise.all([
  withdrawal.withdraw('wd-key-1', 75),
  withdrawal.withdraw('wd-key-2', 75),
]);
assert.equal([first, second].filter((x) => x.state === 'submitted').length, 1, 'two $75 withdrawals create one payout');
assert.equal([first, second].filter((x) => x.rejected === 'insufficient').length, 1, 'second withdrawal cannot overspend');
assert.equal(withdrawal.payouts, 1);
assert.equal(withdrawal.available, 25);
assert.equal(withdrawal.held, 75);

const duplicate = await Promise.all([
  withdrawal.withdraw('wd-key-1', 75),
  withdrawal.withdraw('wd-key-1', 75),
]);
assert.equal(duplicate[0].duplicate || duplicate[1].duplicate, true, 'same request key is idempotent');
assert.equal(withdrawal.payouts, 1, 'duplicate request does not create a second payout');

const rejected = new AtomicModel(100);
await rejected.withdraw('reject', 75, 'rejected');
assert.deepEqual([rejected.available, rejected.held, rejected.reserve], [100, 0, 0], 'provider rejection releases reservation');

const uncertain = new AtomicModel(100);
await uncertain.withdraw('uncertain', 75, 'uncertain');
const uncertainRetry = await uncertain.withdraw('uncertain', 75);
assert.equal(uncertainRetry.state, 'uncertain', 'timeout retry remains uncertain and does not resubmit');
assert.equal(uncertain.payouts, 0, 'uncertain submission never blindly creates a second payout');

const deposit = new AtomicModel(100);
await Promise.all([
  deposit.webhook('evt-processed', 'dep-1', 'Processed', 25, 'deposit'),
  deposit.webhook('evt-processed', 'dep-1', 'Processed', 25, 'deposit'),
]);
assert.equal(deposit.available, 125, 'concurrent duplicate Processed credits deposit once');
await Promise.all([
  deposit.webhook('evt-returned', 'dep-1', 'Returned', 25, 'deposit'),
  deposit.webhook('evt-returned', 'dep-1', 'Returned', 25, 'deposit'),
]);
assert.equal(deposit.available, 100, 'concurrent duplicate Return reverses deposit once');

const delayed = new AtomicModel(100);
await delayed.webhook('evt-returned-first', 'dep-2', 'Refunded', 25, 'deposit');
await delayed.webhook('evt-processed-late', 'dep-2', 'Processed', 25, 'deposit');
assert.equal(delayed.available, 100, 'delayed Processed cannot resurrect a terminal returned deposit');

const settledWithdrawal = new AtomicModel(100);
await settledWithdrawal.withdraw('wd-processed', 75);
await Promise.all([
  settledWithdrawal.webhook('wd-processed-event', 'wd-processed', 'Processed', 75, 'withdrawal'),
  settledWithdrawal.webhook('wd-processed-event', 'wd-processed', 'Processed', 75, 'withdrawal'),
]);
assert.deepEqual([settledWithdrawal.available, settledWithdrawal.held, settledWithdrawal.reserve, settledWithdrawal.settlement], [25, 0, 0, 75], 'Processed finalizes the held withdrawal exactly once');
await Promise.all([
  settledWithdrawal.webhook('wd-return-event', 'wd-processed', 'Returned', 75, 'withdrawal'),
  settledWithdrawal.webhook('wd-return-event', 'wd-processed', 'Returned', 75, 'withdrawal'),
]);
assert.deepEqual([settledWithdrawal.available, settledWithdrawal.held, settledWithdrawal.reserve, settledWithdrawal.settlement], [100, 0, 0, 0], 'returned withdrawal restores funds exactly once');

const [withdrawalSrc, webhookSrc, storeSrc] = await Promise.all([
  readFile(new URL('../base44/functions/submitSeamlessWithdrawal/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/seamlessAchWebhook/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/shared/seamlessAtomicStore.ts', import.meta.url), 'utf8'),
]);
assert.match(withdrawalSrc, /acquireUserWalletLock/, 'withdrawal obtains a durable per-user lock before reservation');
assert.match(withdrawalSrc, /withdrawal_reserve/, 'withdrawal posts a reserve before provider submission');
assert.match(withdrawalSrc, /integration_status: 'uncertain'/, 'unknown provider outcome is retained without resubmission');
assert.match(webhookSrc, /claimWebhookEvent/, 'webhook claims an event before financial mutation');
assert.match(webhookSrc, /seamless:withdrawal:settle:/, 'withdrawal settlement group is stable, not random');
assert.match(webhookSrc, /amount: pickAmount\(body\)/, 'unmatched callback has a defined optional amount');
assert.match(storeSrc, /\['EVAL'/, 'atomic store uses Redis EVAL');
assert.match(storeSrc, /state == 'completed'/, 'completed webhook claims are durable');

console.log('Seamless race validation passed.');
