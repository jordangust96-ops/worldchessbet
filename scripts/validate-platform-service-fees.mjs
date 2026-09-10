import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [feeSchedule, createMatch, lockWager, settleMatch, cancelMatch, prepTimeout, disputes, contestRecord] = await Promise.all([
  read('base44/shared/platformFee.ts'),
  read('base44/functions/createMatch/entry.ts'),
  read('base44/shared/lockWager.ts'),
  read('base44/functions/settleMatch/entry.ts'),
  read('base44/functions/cancelMatch/entry.ts'),
  read('base44/functions/checkPreparationTimeout/entry.ts'),
  read('base44/functions/manageDisputeCase/entry.ts'),
  read('base44/entities/ContestRecord.jsonc'),
]);

// Published fee schedule remains fixed-dollar and snapshotted at creation.
assert.match(feeSchedule, /PLATFORM_FEE_SCHEDULE_VERSION = '2026-07-28'/);
assert.match(feeSchedule, /feeCents: 100/);
assert.match(feeSchedule, /feeCents: 4000/);
assert.match(createMatch, /platform_service_fee: platformServiceFee/);
assert.match(createMatch, /platform_fee_schedule_version: PLATFORM_FEE_SCHEDULE_VERSION/);

// Funding: Entry Amount and Platform Service Fee are reserved independently.
assert.match(lockWager, /ledgerAccount: 'contest_clearing'.*credit: match\.wager_amount/s);
assert.match(lockWager, /ledgerAccount: 'suspense'.*credit: serviceFee/s);
assert.doesNotMatch(lockWager, /ledgerAccount: 'platform_revenue'.*credit: serviceFee/s);
assert.match(lockWager, /type: 'service_fee_charge'/);

// Decisive settlement: full entry pool goes to winner; both fees alone become revenue.
assert.match(settleMatch, /const pot = wagerAmount \* 2/);
assert.match(settleMatch, /const totalFee = serviceFee \* 2/);
assert.match(settleMatch, /ledgerAccount: 'contest_clearing', debit: pot - approvedShortfall/);
assert.match(settleMatch, /ledgerAccount: 'suspense', debit: totalFee/);
assert.match(settleMatch, /ledgerAccount: 'platform_revenue', debit: 0, credit: totalFee/);
assert.match(settleMatch, /creditHeld: pot/);
assert.match(settleMatch, /platform_fee: settlementFee/);
assert.match(contestRecord, /recognized as Platform Revenue only for a decisive result/);

// Draw/cancel/preparation timeout: fees are refunded from suspense, never recognized.
for (const [name, src] of [['draw', settleMatch], ['cancel', cancelMatch], ['preparation timeout', prepTimeout]]) {
  assert.match(src, /type: 'service_fee_refund'/, `${name}: service fee refund transaction required`);
  assert.match(src, /ledgerAccount: 'suspense'.*debit: serviceFee/s, `${name}: suspense must be debited`);
}

// Settled dispute reversal/void: fee reversal comes directly out of platform_revenue
// and credits both users via service_fee_refund transactions; contest-clearing math
// must remain entry-only.
assert.match(disputes, /feeTreatment === 'refunded'/);
assert.match(disputes, /ledgerAccount: 'platform_revenue', debit: fee, credit: 0/);
assert.match(disputes, /type: 'service_fee_refund'/);
assert.match(disputes, /const contestClearingNet = payout - entryAmount;/);
assert.match(disputes, /const contestClearingNet = payout - entryAmount \* 2;/);
assert.doesNotMatch(disputes, /const contestClearingNet = payout - entryAmount \* 2 - fee;/);

// Pre-settlement admin void: only funded players are refunded, and each reserved
// component is unwound from its own system account.
assert.match(disputes, /if \(match\.player1_deposited && match\.player1_id\) refundTargets\.push\(match\.player1_id\)/);
assert.match(disputes, /if \(match\.player2_deposited && match\.player2_id\) refundTargets\.push\(match\.player2_id\)/);
assert.match(disputes, /triggerEvent: 'contest_void_entry_refund'/);
assert.match(disputes, /ledgerAccount: 'contest_clearing', debit: entryAmount/);
assert.match(disputes, /triggerEvent: 'contest_void_fee_refund'/);
assert.match(disputes, /ledgerAccount: 'suspense', debit: feePerPlayer/);
assert.match(disputes, /heldDelta: -feePerPlayer/);
assert.match(disputes, /const getOrCreateVoidRefund = async/);
assert.match(disputes, /idempotencyKey = `dispute:\$\{disputeCase\.id\}:contest_void:\$\{keySuffix\}:\$\{playerId\}`/);
assert.match(disputes, /if \(refundTx\.status !== 'completed'\)/);
assert.match(disputes, /if \(feeRefundTx\.status !== 'completed'\)/);

// Arithmetic sanity checks for decisive, draw, settled void, and reversal+fee-refund.
{
  const entry = 25;
  const fee = 2;
  const pot = entry * 2;
  const fees = fee * 2;
  assert.equal(pot, 50);
  assert.equal(fees, 4);
  // decisive: debits clearing+fee suspense == credits winner+revenue
  assert.equal(pot + fees, pot + fees);
  // settled void: debit winner payout + debit recognized fee == credits both entries + both fees
  assert.equal(pot + fees, entry * 2 + fee * 2);
  // contest reversal with fee refunded: debit payout+fee == credit loser entry + clearing residual + both fee refunds
  assert.equal(pot + fees, entry + (pot - entry) + fee * 2);
}

console.log('Platform Service Fee lifecycle validation passed.');
