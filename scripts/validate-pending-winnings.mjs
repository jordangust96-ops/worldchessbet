import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Pure-JS model of the pending-winnings hold introduced across
// base44/shared/ledger.ts, settleMatch, releasePendingWinnings,
// submitContestReport, manageDisputeCase, and manageIntegrityFlag: a
// winner's payout is credited into Held Balance (not Available Balance) at
// settlement, and only becomes withdrawable after the same 24-hour window
// players have to file a contest report has passed with nothing blocking
// it. Source cross-checks below (against the real deployed files) make sure
// these invariants aren't silently dropped by a future edit.

const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

function applyLeg(wallet, { credit = 0, debit = 0, creditHeld = 0, heldDelta = 0 }) {
  const available = wallet.available - debit + credit;
  const held = wallet.held + heldDelta + creditHeld;
  return { available, held };
}

// Mirrors settleMatch's decisive-branch winner leg.
function settleDecisive(wallet, { wagerAmount, serviceFee, pot }) {
  return applyLeg(wallet, { creditHeld: pot, heldDelta: -(wagerAmount + serviceFee) });
}

// Mirrors releasePendingWinnings' per-candidate gating logic.
function evaluateRelease({ nowMs, releaseAtMs, cases, flags }) {
  if (nowMs < releaseAtMs) return { release: false, reason: 'before_deadline' };
  const hasOpenCase = cases.some((c) => !['resolved', 'closed'].includes(c.status));
  if (hasOpenCase) return { release: false, reason: 'open_case' };
  const hasOpenFairPlayFlag = flags.some(
    (f) =>
      ['open', 'under_review'].includes(f.status) &&
      (f.flag_type === 'settlement_reconciliation_required' ||
        (f.flag_type === 'engine_assistance_suspected' && f.severity !== 'low'))
  );
  if (hasOpenFairPlayFlag) return { release: false, reason: 'open_fair_play_flag' };
  return { release: true, reason: 'eligible' };
}

// Mirrors applyBalanceHold's 'release' direction.
function release(wallet, amount) {
  return { available: wallet.available + amount, held: wallet.held - amount };
}

// Scenario 1: settlement credits the pot into Held Balance, not Available
// Balance — the winner's available balance must not move at settlement.
{
  const wagerAmount = 20;
  const serviceFee = 2;
  const pot = wagerAmount * 2;
  // Wallet already has the winner's own stake reserved in held_balance from
  // wager-lock time (available was debited then, not now).
  const walletAfterLock = { available: 100, held: wagerAmount + serviceFee };
  const walletAfterSettlement = settleDecisive(walletAfterLock, { wagerAmount, serviceFee, pot });

  assert.equal(walletAfterSettlement.available, 100, 'available balance is unchanged at settlement — the payout is pending, not paid out');
  assert.equal(walletAfterSettlement.held, pot, "held balance now holds exactly the pot (winner's own stake reservation released, replaced by the full pending payout)");
}

// Scenario 2: past the 24-hour deadline with no case and no qualifying flag
// — releasePendingWinnings must release it.
{
  const now = Date.now();
  const decision = evaluateRelease({ nowMs: now, releaseAtMs: now - 1000, cases: [], flags: [] });
  assert.equal(decision.release, true, 'a clean payout past its deadline is released');

  const wallet = { available: 100, held: 40 };
  const released = release(wallet, 40);
  assert.equal(released.available, 140, 'released funds move to available balance');
  assert.equal(released.held, 0, 'released funds leave held balance');
}

// Scenario 3: not yet past the deadline — must not release even with
// nothing else blocking it.
{
  const now = Date.now();
  const decision = evaluateRelease({ nowMs: now, releaseAtMs: now + REPORT_WINDOW_MS, cases: [], flags: [] });
  assert.equal(decision.release, false, 'a payout is never released before its 24-hour deadline');
  assert.equal(decision.reason, 'before_deadline');
}

// Scenario 4: an open (unresolved) DisputeCase blocks release, matching "if
// a report is filed within that window, funds remain pending under review."
{
  const now = Date.now();
  const decision = evaluateRelease({
    nowMs: now, releaseAtMs: now - 1000,
    cases: [{ status: 'open' }], flags: [],
  });
  assert.equal(decision.release, false, 'an open case blocks release even past the deadline');
  assert.equal(decision.reason, 'open_case');

  const resolvedDecision = evaluateRelease({
    nowMs: now, releaseAtMs: now - 1000,
    cases: [{ status: 'resolved' }], flags: [],
  });
  assert.equal(resolvedDecision.release, true, 'a resolved case no longer blocks the sweep (resolve_case already released/consumed the hold itself)');
}

// Scenario 5: an autonomous, unreported review-band Fair Play flag also
// blocks release (closing the gap where Stockfish flags a match nobody
// reported) — but a soft monitor-band flag (severity 'low') must NOT block
// it indefinitely, or an ordinary weak signal would freeze funds forever.
{
  const now = Date.now();
  const reviewBand = evaluateRelease({
    nowMs: now, releaseAtMs: now - 1000, cases: [],
    flags: [{ flag_type: 'engine_assistance_suspected', severity: 'medium', status: 'open' }],
  });
  assert.equal(reviewBand.release, false, 'an open review-band (non-low-severity) engine_assistance_suspected flag blocks release');

  const monitorBand = evaluateRelease({
    nowMs: now, releaseAtMs: now - 1000, cases: [],
    flags: [{ flag_type: 'engine_assistance_suspected', severity: 'low', status: 'open' }],
  });
  assert.equal(monitorBand.release, true, 'a monitor-band (severity low) flag alone does not block release');

  const reconciliation = evaluateRelease({
    nowMs: now, releaseAtMs: now - 1000, cases: [],
    flags: [{ flag_type: 'settlement_reconciliation_required', severity: 'low', status: 'under_review' }],
  });
  assert.equal(reconciliation.release, false, 'settlement_reconciliation_required always blocks release regardless of severity');
}

// Scenario 6: manageDisputeCase's contest_reversed must debit the winner's
// reversal from Held Balance when their payout is still pending (not from
// Available Balance, which may not hold the money at all under this model).
{
  const pendingPayout = { user_id: 'winner-1', amount: 40, payout_hold_status: 'held' };
  const winnerId = 'winner-1';
  const pendingPayoutCoversThis = pendingPayout.user_id === winnerId;
  const holdCoversThis = pendingPayoutCoversThis; // no explicit admin hold in this scenario
  assert.equal(holdCoversThis, true, 'a pending settlement hold makes fromHeld true for the reversal debit leg, matching manageDisputeCase');

  // fromHeld debit model, mirroring postRemedyLegs.
  const wallet = { available: 5, held: 40 };
  const debit = Math.min(pendingPayout.amount, wallet.held);
  const afterDebit = { available: wallet.available, held: wallet.held - debit };
  assert.equal(debit, 40, 'the full pending payout is debited from held balance, not available balance');
  assert.equal(afterDebit.available, 5, "the winner's unrelated available balance is untouched by the reversal");
  assert.equal(afterDebit.held, 0, 'held balance is fully consumed by the reversal');
}

// Cross-check against the actual deployed source so a future edit that
// quietly drops one of these guards fails this test, not just the model.
const [
  ledgerSrc, settleMatchSrc, releaseSrc, reportSrc, disputeSrc, flagSrc, walletTxnSchemaSrc, windowSrc,
] = await Promise.all([
  readFile(new URL('../base44/shared/ledger.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/settleMatch/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/releasePendingWinnings/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/submitContestReport/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/manageDisputeCase/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/manageIntegrityFlag/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/entities/WalletTransaction.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../base44/shared/reportWindow.ts', import.meta.url), 'utf8'),
]);

assert.match(windowSrc, /REPORT_WINDOW_MS = 24 \* 60 \* 60 \* 1000/, 'a single shared 24-hour window constant exists');
assert.match(ledgerSrc, /creditHeld/, 'postLedgerLegs supports crediting Held Balance directly');
assert.match(ledgerSrc, /export async function applyBalanceHold/, 'applyBalanceHold is shared, not duplicated per file');
assert.match(settleMatchSrc, /creditHeld: pot/, "settleMatch credits the winner's pot into Held Balance, not Available Balance");
assert.match(settleMatchSrc, /payout_hold_status: 'held'/, 'settleMatch stamps the payout as held at creation');
assert.match(settleMatchSrc, /payout_release_at: new Date\(Date\.now\(\) \+ REPORT_WINDOW_MS\)/, "settleMatch's release deadline uses the shared window constant");
assert.match(releaseSrc, /payout_hold_status: 'held'/, 'releasePendingWinnings queries held payouts');
assert.match(releaseSrc, /hasOpenCase/, 'releasePendingWinnings checks for an open DisputeCase before releasing');
assert.match(releaseSrc, /f\.severity !== 'low'/, 'releasePendingWinnings only lets a non-monitor-band Fair Play flag block release');
assert.match(reportSrc, /REPORT_WINDOW_MS, CLOCK_SKEW_TOLERANCE_MS \} from '\.\.\/\.\.\/shared\/reportWindow\.ts'/, 'submitContestReport uses the shared report window constant');
assert.match(reportSrc, /if \(!transactionId && match\.status === 'completed' && contestRecord\?\.settlement_timestamp\)/, 'submitContestReport enforces the 24-hour deadline uniformly, not only for wallet-transaction-sourced reports');
assert.match(disputeSrc, /pendingPayoutCoversThis/, 'manageDisputeCase accounts for the automatic pending-winnings hold in its reversal/void logic');
assert.match(disputeSrc, /payout_hold_status: 'consumed'/, 'manageDisputeCase marks a pending payout consumed when a reversal/void debits it');
assert.match(disputeSrc, /pending_winnings_release/, 'manageDisputeCase releases any still-held pending payout once a case concludes');
assert.match(disputeSrc, /existingPendingPayout/, 'place_post_settlement_hold adopts an existing automatic hold instead of double-holding');
assert.match(flagSrc, /'open_case'/, 'manageIntegrityFlag exposes an admin action to open a case directly from a flag');
assert.match(flagSrc, /releaseMatchPendingPayoutIfUnblocked/, 'manageIntegrityFlag can release a pending payout that only an autonomous flag was holding');
assert.match(walletTxnSchemaSrc, /payout_hold_status/, 'WalletTransaction schema carries payout_hold_status');
assert.match(walletTxnSchemaSrc, /payout_release_at/, 'WalletTransaction schema carries payout_release_at');

console.log('Pending-winnings hold validation passed.');
