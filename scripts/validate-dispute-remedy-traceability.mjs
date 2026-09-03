import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression test for two related traceability/integrity findings from the
// full referential-integrity audit:
//
// Finding #4 (dispute-resolution money movement had no WalletTransaction):
// manageDisputeCase's contest_reversed/contest_voided remedies moved real
// money via postRemedyLegs/applyBalanceHold directly into LedgerEntry rows,
// with no WalletTransaction ever created for the clawback or the refund —
// unlike every other money-moving flow in the app (settleMatch, cancelMatch,
// submitSeamlessWithdrawal, etc.), which always creates a WalletTransaction
// first and tags every LedgerEntry it posts with wallet_transaction_id. A
// user's transaction history and an admin's per-case financial review (via
// DisputeCase.wallet_transaction_ids, already a schema field but never
// populated) had no record of these remedies at all.
//
// Finding #5 (payout-election race): settleMatch's concurrent-settlement
// safeguard (createCanonicalSettlementTransaction) can leave a losing/failed
// settlement-election candidate WalletTransaction stamped
// payout_hold_status: 'held' from its own creation, with no live pending
// payout behind it. Three sites queried/matched on payout_hold_status:
// 'held' alone (manageDisputeCase's place_post_settlement_hold and
// resolve_case, and releasePendingWinnings' sweep) and could mistake that
// stale flag for a real pending payout. All three now also require
// status === 'completed', and settleMatch's markSettlementAttempt now
// clears the flag at the source by setting it to the new 'void' enum value
// on any losing/failed candidate.

// --- Model: splitting a combined debit+credit leg into two independently
// tracked legs (so each can carry its own WalletTransaction id) must land
// the wallet in the exact same final state as the original single leg. This
// is what contest_voided's settled-winner leg was refactored into.
function applyLegs(wallet, legs) {
  let { available, held } = wallet;
  for (const leg of legs) {
    let debit = leg.debit || 0;
    if (leg.fromHeld && debit > 0) {
      debit = Math.min(debit, held);
      held -= debit;
      available += leg.credit || 0;
    } else {
      debit = Math.min(debit, available);
      available = available - debit + (leg.credit || 0);
    }
  }
  return { available, held };
}

{
  const startingWallet = { available: 5, held: 300 };
  const payout = 180;
  const entryAmount = 100;

  const combinedLeg = [{ debit: payout, credit: entryAmount, fromHeld: true }];
  const splitLegs = [
    { debit: payout, credit: 0, fromHeld: true },
    { debit: 0, credit: entryAmount, fromHeld: false },
  ];

  const combinedResult = applyLegs(startingWallet, combinedLeg);
  const splitResult = applyLegs(startingWallet, splitLegs);

  assert.deepEqual(splitResult, combinedResult, 'splitting the mixed debit+credit leg into two legs (one per WalletTransaction) must produce the identical final wallet state as the original combined leg');
  assert.equal(splitResult.available, 105, 'available balance gains exactly the refunded entry amount');
  assert.equal(splitResult.held, 120, "held balance loses exactly the clawed-back payout (300 - 180)");
}

// --- Model: the payout-election race guard. A losing settlement-election
// candidate's WalletTransaction can carry payout_hold_status: 'held' while
// status is 'failed' or 'review_required' — status:'completed' is what
// distinguishes the one real pending payout from any such stale duplicate.
function findRealPendingPayout(candidates, userId) {
  return candidates.find((t) => t.status === 'completed' && t.payout_hold_status === 'held' && t.user_id === userId) || null;
}
{
  const candidates = [
    { user_id: 'winner-1', status: 'failed', payout_hold_status: 'held', amount: 40 },
    { user_id: 'winner-1', status: 'completed', payout_hold_status: 'held', amount: 36 },
  ];
  const real = findRealPendingPayout(candidates, 'winner-1');
  assert.equal(real.amount, 36, 'a status:completed+held candidate is found even when a status:failed duplicate also carries payout_hold_status:held');

  const onlyStale = [{ user_id: 'winner-1', status: 'failed', payout_hold_status: 'held', amount: 40 }];
  assert.equal(findRealPendingPayout(onlyStale, 'winner-1'), null, 'a status:failed candidate alone must never be mistaken for a real pending payout, regardless of payout_hold_status');
}

// --- Cross-check against the actual deployed source.
const [
  disputeSrc, ledgerSrc, settleMatchSrc, releaseSrc, walletTxnSchemaSrc, disputeCaseSchemaSrc, caseResolutionSchemaSrc,
] = await Promise.all([
  readFile(new URL('../base44/functions/manageDisputeCase/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/shared/ledger.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/settleMatch/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/releasePendingWinnings/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/entities/WalletTransaction.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../base44/entities/DisputeCase.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../base44/entities/CaseResolution.jsonc', import.meta.url), 'utf8'),
]);

// Finding #4: every user-facing remedy leg gets its own WalletTransaction,
// tagged onto the ledger leg it backs, before any money moves.
assert.match(walletTxnSchemaSrc, /"admin_reversal"/, 'WalletTransaction.type carries admin_reversal for dispute-remedy clawbacks');

assert.match(disputeSrc, /type: 'admin_reversal',[\s\S]{0,200}source_event: 'dispute_case_contest_reversal'/, 'contest_reversed creates an admin_reversal WalletTransaction for the winner clawback');
assert.match(disputeSrc, /type: 'wager_refund',[\s\S]{0,200}source_event: 'dispute_case_contest_reversal'/, 'contest_reversed creates a wager_refund WalletTransaction for the loser refund');
assert.match(disputeSrc, /legs\.push\(\{ ledgerAccount: 'user_account', userId: winnerId, debit: payout, credit: 0, fromHeld: holdCoversThis, transactionType: 'reversal', walletTransactionId: winnerReversalTx\.id \}\);/, "contest_reversed's winner debit leg is tagged with its own WalletTransaction id");
assert.match(disputeSrc, /legs\.push\(\{ ledgerAccount: 'user_account', userId: loserId, debit: 0, credit: entryAmount, transactionType: 'reversal', walletTransactionId: loserRefundTx\.id \}\);/, "contest_reversed's loser credit leg is tagged with its own WalletTransaction id");
assert.match(disputeSrc, /resolutionFields\.reversal_wallet_transaction_ids = walletTransactionIds;/, 'contest_reversed records its WalletTransaction ids on the CaseResolution');

assert.match(disputeSrc, /type: 'admin_reversal',[\s\S]{0,200}source_event: 'dispute_case_contest_void'/, 'contest_voided (settled) creates an admin_reversal WalletTransaction for the winner clawback');
assert.doesNotMatch(disputeSrc, /debit: payout, credit: entryAmount, fromHeld: holdCoversThis, transactionType: 'reversal' \}\);/, "contest_voided's winner leg no longer mixes a debit and a credit in one untracked leg — it is split so each side gets its own WalletTransaction");
assert.match(disputeSrc, /description: `Entry amount refunded — contest voided before settlement, Case #\$\{fmtCase\(disputeCase\.case_number\)\}`/, 'the not-yet-settled contest_voided branch also creates a WalletTransaction per refunded player, not just the settled branch');
assert.match(disputeSrc, /walletTransactionId,\s*\n\s*\}\);\s*\n\s*if \(entry\) entries\.push\(entry\);/, 'the not-yet-settled refund is threaded into applyBalanceHold via walletTransactionId');
assert.match(disputeSrc, /resolutionFields\.void_wallet_transaction_ids = walletTransactionIds;/, 'contest_voided records its WalletTransaction ids on the CaseResolution');

assert.match(disputeSrc, /caseUpdates\.wallet_transaction_ids = \[\.\.\.\(disputeCase\.wallet_transaction_ids \|\| \[\]\), \.\.\.walletTransactionIds\];/, 'both remedy branches append their new WalletTransaction ids onto the case\'s own wallet_transaction_ids field for admin financial review');

assert.match(disputeSrc, /walletTransactionId: pendingPayout\.id,/, 'the end-of-case pending-payout release also tags its ledger leg back to the original payout WalletTransaction');

assert.match(disputeSrc, /wallet_transaction_id: leg\.walletTransactionId \|\| ''/, "postRemedyLegs threads each leg's walletTransactionId onto the LedgerEntry it creates");

assert.match(ledgerSrc, /walletTransactionId = ''/, 'applyBalanceHold accepts an optional walletTransactionId parameter');
assert.match(ledgerSrc, /wallet_transaction_id: walletTransactionId \|\| ''/, 'applyBalanceHold tags the LedgerEntry it creates with the caller-supplied walletTransactionId');

assert.match(disputeCaseSchemaSrc, /"wallet_transaction_ids"/, 'DisputeCase already had a wallet_transaction_ids field — it is now actually populated by manageDisputeCase');
assert.match(caseResolutionSchemaSrc, /"reversal_wallet_transaction_ids"/, 'CaseResolution schema carries reversal_wallet_transaction_ids alongside reversal_ledger_entry_ids');
assert.match(caseResolutionSchemaSrc, /"void_wallet_transaction_ids"/, 'CaseResolution schema carries void_wallet_transaction_ids alongside void_ledger_entry_ids');

// Finding #5: all three payout-election-race sites require status:'completed'
// in addition to payout_hold_status:'held', and settleMatch clears the flag
// on losing candidates at the source.
assert.match(walletTxnSchemaSrc, /"void"/, 'WalletTransaction.payout_hold_status carries the void state for losing settlement-election candidates');
assert.match(settleMatchSrc, /payout_hold_status: 'void'/, "settleMatch's markSettlementAttempt clears the stale held marker on a losing/failed settlement candidate");

assert.match(disputeSrc, /\.find\(\(t\) => t\.status === 'completed' && t\.payout_hold_status === 'held'\);/, "place_post_settlement_hold's existing-hold lookup requires status:'completed'");
assert.match(disputeSrc, /\.find\(\(t\) => t\.status === 'completed' && t\.payout_hold_status === 'held'\) \|\| null;/, "resolve_case's pending-payout lookup requires status:'completed'");

assert.match(releaseSrc, /\{ type: 'payout', status: 'completed', payout_hold_status: 'held' \},/, "releasePendingWinnings' main sweep query requires status:'completed'");
assert.match(releaseSrc, /transaction\.status !== 'completed' \|\| transaction\.payout_hold_status !== 'held'/, "releasePendingWinnings' fresh re-fetch guard requires status:'completed'");
assert.match(releaseSrc, /preCommit\.status !== 'completed' \|\| preCommit\.payout_hold_status !== 'held'/, "releasePendingWinnings' final pre-commit guard requires status:'completed'");
assert.match(releaseSrc, /walletTransactionId: transaction\.id,/, 'releasePendingWinnings also tags its release ledger leg back to the payout WalletTransaction it is releasing');

console.log('Dispute-remedy traceability and payout-election-race validation passed.');
