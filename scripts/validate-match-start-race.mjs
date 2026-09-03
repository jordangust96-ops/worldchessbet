import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Pure-JS model of the interaction between finalizeMatchStart (the
// certified+funded -> live transition) and checkPreparationTimeout (the
// preparation-timeout refund sweep), mirroring the hardened control flow in
// base44/functions/finalizeMatchStart/entry.ts and
// base44/functions/checkPreparationTimeout/entry.ts. This exercises the
// interleavings that, before this fix, could let the sweep refund-and-cancel
// a match in the same narrow window finalizeMatchStart was bringing it live
// — a free real-money game plus a full refund. Each Match.get/Match.update
// round trip is modeled as taking a fixed 1ms so the interleavings below are
// fully deterministic under Node's single-threaded timer ordering, not
// dependent on real I/O jitter.

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStore(initial) {
  let record = { ...initial };
  return {
    async get() {
      await delay(1);
      return { ...record };
    },
    async update(patch) {
      await delay(1);
      record = { ...record, ...patch };
      return { ...record };
    },
  };
}

const LIVE_OR_POST_START_STATUSES = new Set(['both_ready', 'in_progress', 'settling', 'completed']);

// Mirrors finalizeMatchStart/entry.ts.
async function runFinalizeMatchStart(store, { claimWaitMs = 20 } = {}) {
  let match = await store.get();
  if (['in_progress', 'completed', 'cancelled'].includes(match.status)) return match;
  if (match.cancellation_operation_id || match.status === 'cancelling') return match;

  const bothCertified = match.player1_certified && match.player2_certified;
  const bothDeposited = match.player1_deposited && match.player2_deposited;
  if (!bothCertified || !bothDeposited) return match;

  if (!match.start_operation_id) {
    const startOperationId = `start-${Math.random().toString(36).slice(2)}`;
    await store.update({ start_operation_id: startOperationId, status: 'both_ready' });
    await delay(claimWaitMs);
    match = await store.get();
    if (match.start_operation_id !== startOperationId) return match;
  }

  if (match.cancellation_operation_id || match.status === 'cancelling' || match.status === 'cancelled') {
    return match;
  }

  // Mirrors getOrCreateGame's own status gate + attach.
  let gameCreated = false;
  if (LIVE_OR_POST_START_STATUSES.has(match.status)) {
    gameCreated = true;
    if (!match.game_id) await store.update({ game_id: 'game-1' });
  }

  match = await store.get();
  if (match.cancellation_operation_id || ['cancelling', 'cancelled', 'in_progress', 'completed'].includes(match.status)) {
    return { ...match, gameCreated };
  }
  match = await store.update({ status: 'in_progress' });
  return { ...match, gameCreated };
}

// Mirrors checkPreparationTimeout/entry.ts's per-candidate logic (the outer
// query + staleness filter that selects candidates is untouched by this fix
// and isn't re-modeled here).
async function runTimeoutSweepCandidate(store, { claimWaitMs = 20 } = {}) {
  let match = await store.get();
  if (match.status !== 'preparing' && match.status !== 'both_ready') return { skipped: true, match };
  if (match.cancellation_operation_id || match.status === 'cancelling') return { skipped: true, match };
  if (match.start_operation_id) return { skipped: true, match };
  const bothCertified = match.player1_certified && match.player2_certified;
  const bothDeposited = match.player1_deposited && match.player2_deposited;
  if (bothCertified && bothDeposited) return { skipped: true, match };

  const cancellationOperationId = `cancel-${Math.random().toString(36).slice(2)}`;
  await store.update({ status: 'cancelling', cancellation_operation_id: cancellationOperationId });
  await delay(claimWaitMs);
  match = await store.get();
  if (match.cancellation_operation_id !== cancellationOperationId) return { skipped: true, match };
  if (match.start_operation_id) {
    await store.update({ status: 'both_ready', cancellation_operation_id: '' });
    return { backedOff: true, match };
  }
  match = await store.update({ status: 'cancelled', refunded: true });
  return { cancelled: true, match };
}

// Scenario 1: a genuinely abandoned, never-funded match. The sweep must
// still cancel it cleanly, and a finalize call arriving afterward must defer
// rather than reviving a cancelled match.
{
  const store = createStore({
    status: 'preparing',
    player1_certified: true, player1_deposited: true,
    player2_certified: false, player2_deposited: false,
    cancellation_operation_id: '', start_operation_id: '', game_id: '',
  });
  const sweep = await runTimeoutSweepCandidate(store, { claimWaitMs: 5 });
  assert.equal(sweep.cancelled, true, 'a genuinely abandoned match is still cancelled');
  const late = await runFinalizeMatchStart(store);
  assert.notEqual(late.status, 'in_progress', 'a cancelled match can never be revived by a late finalize call');
}

// Scenario 2: both players are already certified & funded by the time the
// sweep re-validates its candidate. The defense-in-depth check must skip it
// outright, and finalize must still be free to bring it live.
{
  const store = createStore({
    status: 'both_ready',
    player1_certified: true, player1_deposited: true,
    player2_certified: true, player2_deposited: true,
    cancellation_operation_id: '', start_operation_id: '', game_id: '',
  });
  const sweep = await runTimeoutSweepCandidate(store);
  assert.equal(sweep.skipped, true, 'a fully certified & funded match is never cancelled by the sweep');
  const finalize = await runFinalizeMatchStart(store);
  assert.equal(finalize.status, 'in_progress', 'finalize still brings the untouched match live');
  assert.equal(finalize.gameCreated, true);
}

// Scenario 3 (the race this fix targets): the sweep claims 'cancelling' on a
// match that is not yet fully funded. Moments later — inside the sweep's own
// claim-confirmation wait — a concurrent finalizeMatchStart call (whose
// entry checks had already passed against an earlier read) writes its own
// start_operation_id claim. Before this fix, the sweep's re-check only
// compared its own operation id and would have proceeded to post a refund
// for a match that was, by then, actually going live. It must now detect
// the intruding start claim, back off before any refund is posted, and hand
// the match back to 'both_ready' rather than stranding it mid-cancel.
{
  const store = createStore({
    status: 'preparing',
    player1_certified: true, player1_deposited: true,
    player2_certified: true, player2_deposited: false,
    cancellation_operation_id: '', start_operation_id: '', game_id: '',
  });

  const sweepPromise = runTimeoutSweepCandidate(store, { claimWaitMs: 30 });
  const intrudingStartClaim = (async () => {
    await delay(10); // lands well inside the sweep's 30ms claim-confirmation wait
    await store.update({ start_operation_id: 'external-start-claim', status: 'both_ready', player2_deposited: true });
  })();

  const [sweepResult] = await Promise.all([sweepPromise, intrudingStartClaim]);
  assert.equal(sweepResult.backedOff, true, 'the sweep must back off once a start claim appears, not cancel');

  const midState = await store.get();
  assert.equal(midState.refunded, undefined, 'no refund was ever posted');
  assert.equal(midState.cancellation_operation_id, '', 'the cancellation claim is cleared on back-off');
  assert.equal(midState.status, 'both_ready', 'the match is handed back to both_ready, not left stranded in cancelling');

  // finalizeMatchStart's own retry (start_operation_id already set — the
  // documented repair path) must still complete the match normally.
  const finalized = await runFinalizeMatchStart(store);
  assert.equal(finalized.status, 'in_progress', 'the start transition still completes after the sweep backs off');
  assert.equal(finalized.gameCreated, true);
  const endState = await store.get();
  assert.equal(endState.refunded, undefined, 'still no refund was ever posted for a match that went live');
}

// Scenario 4: a crashed/partial finalizeMatchStart invocation (claimed
// start_operation_id and flipped to both_ready, but never got to create the
// Game or flip to in_progress) must be safely resumable by a later call —
// the documented repair path finalizeMatchStart relies on.
{
  const store = createStore({
    status: 'both_ready',
    player1_certified: true, player1_deposited: true,
    player2_certified: true, player2_deposited: true,
    cancellation_operation_id: '', start_operation_id: 'earlier-claim', game_id: '',
  });
  const repaired = await runFinalizeMatchStart(store);
  assert.equal(repaired.status, 'in_progress', 'a stuck both_ready match is repaired by a later call');
  assert.equal(repaired.gameCreated, true);
}

// Scenario 5: an already-cancelled match must never be revived, even if its
// certified/deposited flags are (impossibly) still set.
{
  const store = createStore({
    status: 'cancelled',
    player1_certified: true, player1_deposited: true,
    player2_certified: true, player2_deposited: true,
    cancellation_operation_id: '', start_operation_id: '', game_id: '',
  });
  const result = await runFinalizeMatchStart(store);
  assert.equal(result.status, 'cancelled');
  assert.notEqual(result.gameCreated, true, 'getOrCreateGame is never reached for an already-cancelled match');
}

// Cross-check the invariants above against the actual deployed source, so a
// future edit that quietly drops the guard fails this test rather than only
// the pure-JS model above.
const [finalizeSrc, sweepSrc, cancelSrc, gameSrc, matchSchemaSrc] = await Promise.all([
  readFile(new URL('../base44/functions/finalizeMatchStart/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/checkPreparationTimeout/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/cancelMatch/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/getOrCreateGame/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/entities/Match.jsonc', import.meta.url), 'utf8'),
]);

assert.match(finalizeSrc, /start_operation_id/, 'finalizeMatchStart claims the both_ready -> in_progress transition');
assert.match(finalizeSrc, /cancellation_operation_id \|\| match\.status === 'cancelling'/, 'finalizeMatchStart defers to an in-flight cancellation');
assert.match(finalizeSrc, /Final guard, taken fresh right before declaring the match live/, 'finalizeMatchStart re-checks immediately before committing in_progress');
assert.match(sweepSrc, /if \(match\.start_operation_id\) continue;/, 'the sweep skips a match already claimed for start');
assert.match(sweepSrc, /if \(match\.start_operation_id\) \{/, 'the sweep re-checks for a start claim after its own claim delay');
assert.match(sweepSrc, /cancellation_operation_id: ''/, 'the sweep reverts its claim cleanly instead of stranding the match');
assert.match(sweepSrc, /Re-fetch fresh state immediately before claiming/, 'the sweep no longer acts on a stale query snapshot');
assert.match(cancelSrc, /start_operation_id/, 'user-initiated cancellation also respects an in-flight start claim');
assert.match(gameSrc, /LIVE_OR_POST_START_STATUSES/, 'getOrCreateGame gates Game creation/attachment on match status');
assert.match(matchSchemaSrc, /start_operation_id/, 'Match schema carries the start_operation_id claim field');

console.log('Match start/cancellation race validation passed.');
