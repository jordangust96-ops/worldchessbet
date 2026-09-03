import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Pure-JS model of the game-ending endpoints' hardened control flow
// (submitMove's endgame/timeout branches, checkTimeout, resignGame,
// respondDraw), mirroring base44/functions/*/entry.ts. settleMatch treats
// whatever ends up on a completed Game record as ground truth for who gets
// paid, so the two properties this exercises are load-bearing:
//
//   1. A draw offer must not survive a subsequent move — otherwise a losing
//      player can fall back to a stale offer made earlier in the game to
//      avoid a loss (real refund vs. real payout on the line).
//   2. A terminal write whose pre-commit re-check runs *after* a competing
//      terminal write has already landed must back off, not silently
//      overwrite it. (This models the guarantee the re-check actually
//      provides — a genuinely exact tie, where both competitors' pre-commit
//      reads land before either has written, is not fully serialized
//      without a true claim/operation-id mechanism, which this endpoint set
//      does not use; see the accompanying summary for that tradeoff.)

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

// Mirrors resignGame/entry.ts.
async function runResign(store, { resignerColor }) {
  const game = await store.get();
  if (game.status === 'completed') return { error: 'already_ended' };
  const preCommit = await store.get();
  if (preCommit.status === 'completed') return { error: 'already_ended' };
  return store.update({
    status: 'completed',
    result: resignerColor === 'w' ? 'black_win' : 'white_win',
    winner_id: resignerColor === 'w' ? 'black-player' : 'white-player',
    end_reason: 'resignation',
    draw_offered_by: '',
  });
}

// Mirrors submitMove/entry.ts's checkmate-ending branch (the move itself is
// assumed legal and delivers mate; only the completion write is modeled).
async function runCheckmateMove(store, { winnerColor, moveFen }) {
  const game = await store.get();
  if (game.status === 'completed') return { error: 'already_ended' };
  const preCommit = await store.get();
  if (preCommit.status === 'completed' || preCommit.fen !== game.fen) return { error: 'stale' };
  return store.update({
    status: 'completed',
    result: winnerColor === 'w' ? 'white_win' : 'black_win',
    winner_id: winnerColor === 'w' ? 'white-player' : 'black-player',
    end_reason: 'checkmate',
    fen: moveFen,
    draw_offered_by: '',
  });
}

// Mirrors submitMove/entry.ts's normal (non-ending) move branch — clears any
// pending draw offer and advances the fen.
async function runOrdinaryMove(store, { newFen }) {
  const game = await store.get();
  if (game.status === 'completed') return { error: 'already_ended' };
  const preCommit = await store.get();
  if (preCommit.status === 'completed' || preCommit.fen !== game.fen) return { error: 'stale' };
  return store.update({ fen: newFen, draw_offered_by: '' });
}

// Mirrors respondDraw/entry.ts's 'accept' action.
async function runAcceptDraw(store, { responderId }) {
  const game = await store.get();
  if (game.status === 'completed') return { error: 'already_ended' };
  if (!game.draw_offered_by) return { error: 'no_offer' };
  if (game.draw_offered_by === responderId) return { error: 'own_offer' };
  const preCommit = await store.get();
  if (preCommit.status === 'completed') return { error: 'already_ended' };
  if (preCommit.draw_offered_by !== game.draw_offered_by) return { error: 'offer_no_longer_active' };
  return store.update({
    status: 'completed',
    result: 'draw',
    winner_id: '',
    end_reason: 'draw_agreement',
    draw_offered_by: '',
  });
}

// Scenario 1 (the fix's core purpose): a draw was offered long ago and never
// declined. Several moves have since been played. The offer must no longer
// be acceptable — an ordinary move must have invalidated it.
{
  const store = createStore({
    status: 'active',
    fen: 'position-0',
    draw_offered_by: 'white-player',
  });
  await runOrdinaryMove(store, { newFen: 'position-1' });
  await runOrdinaryMove(store, { newFen: 'position-2' });
  const result = await runAcceptDraw(store, { responderId: 'black-player' });
  assert.equal(result.error, 'no_offer', 'a draw offer does not survive a subsequent move');
}

// Scenario 2: a resignation commits while a competing checkmate attempt's
// *entry* check had already passed (the game still looked active when it
// started) but its pre-commit re-check runs afterward. The re-check — not
// just the entry check — must catch this and reject the late attempt.
{
  const store = createStore({ status: 'active', fen: 'position-0' });

  const resignPromise = runResign(store, { resignerColor: 'b' }); // white wins

  const lateMateAttempt = (async () => {
    await delay(1);
    const game = await store.get(); // entry check: still active at this point
    if (game.status === 'completed') return { error: 'already_ended' };
    await delay(10); // the resignation fully commits within this gap
    const preCommit = await store.get();
    if (preCommit.status === 'completed' || preCommit.fen !== game.fen) return { error: 'stale' };
    return store.update({ status: 'completed', result: 'white_win', winner_id: 'someone-else', end_reason: 'checkmate' });
  })();

  const [resignResult, mateResult] = await Promise.all([resignPromise, lateMateAttempt]);
  const final = await store.get();

  assert.equal(resignResult.error, undefined, 'the resignation commits');
  assert.notEqual(mateResult.error, undefined, 'a late-arriving completion attempt is rejected by the pre-commit re-check');
  assert.equal(final.end_reason, 'resignation', 'the first-committed outcome is never overwritten');
}

// Scenario 3 (the exploit this closes): a stale draw-accept is in flight
// when an actual checkmate move commits. The accept's entry check already
// passed (the offer looked valid when it started), but by the time it
// reaches its pre-commit re-check, the checkmate has already landed — this
// must be caught, rather than silently overwriting the decisive result with
// a refunded draw.
{
  const store = createStore({
    status: 'active',
    fen: 'position-0',
    draw_offered_by: 'black-player',
  });

  const staleAcceptAttempt = (async () => {
    const game = await store.get(); // offer looks valid
    if (game.status === 'completed') return { error: 'already_ended' };
    if (!game.draw_offered_by) return { error: 'no_offer' };
    await delay(10); // the winning move fully commits within this gap
    const preCommit = await store.get();
    if (preCommit.status === 'completed') return { error: 'already_ended' };
    if (preCommit.draw_offered_by !== game.draw_offered_by) return { error: 'offer_no_longer_active' };
    return store.update({ status: 'completed', result: 'draw', winner_id: '', draw_offered_by: '' });
  })();

  const matePromise = (async () => {
    await delay(1);
    return runCheckmateMove(store, { winnerColor: 'w', moveFen: 'position-mate' });
  })();

  const [acceptResult, mateResult] = await Promise.all([staleAcceptAttempt, matePromise]);
  const final = await store.get();

  assert.equal(mateResult.error, undefined, 'the real checkmate commits successfully');
  assert.notEqual(acceptResult.error, undefined, 'the stale draw-accept is rejected, not silently applied');
  assert.equal(final.status, 'completed');
  assert.equal(final.result, 'white_win', 'the decisive result stands — never overwritten by a stale draw');
}

// Scenario 4: a same-player double-submit where the second attempt's
// pre-commit re-check runs after the first has already committed — it must
// be rejected as stale, not silently applied on top of a position it never
// actually saw.
{
  const store = createStore({ status: 'active', fen: 'position-0' });

  const firstMove = runOrdinaryMove(store, { newFen: 'position-1a' });

  const staleSecondMove = (async () => {
    const game = await store.get(); // reads the same starting position
    if (game.status === 'completed') return { error: 'already_ended' };
    await delay(10); // the first move fully commits within this gap
    const preCommit = await store.get();
    if (preCommit.status === 'completed' || preCommit.fen !== game.fen) return { error: 'stale' };
    return store.update({ fen: 'position-1b', draw_offered_by: '' });
  })();

  const [firstResult, secondResult] = await Promise.all([firstMove, staleSecondMove]);
  assert.equal(firstResult.error, undefined, 'the first move commits');
  assert.notEqual(secondResult.error, undefined, 'a stale second move against the same position is rejected');
  const final = await store.get();
  assert.equal(final.fen, 'position-1a', 'the first-committed move is never silently overwritten');
}

// Cross-check against the actual deployed source so a future edit that
// quietly drops one of these guards fails this test, not just the model.
const [submitMoveSrc, checkTimeoutSrc, resignSrc, respondDrawSrc, gameSchemaSrc] = await Promise.all([
  readFile(new URL('../base44/functions/submitMove/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/checkTimeout/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/resignGame/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/respondDraw/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/entities/Game.jsonc', import.meta.url), 'utf8'),
]);

assert.match(submitMoveSrc, /draw_offered_by: ''/, 'submitMove clears any pending draw offer on every move');
assert.match(submitMoveSrc, /preCommitGame\.fen !== game\.fen/, 'submitMove re-validates fen immediately before committing');
assert.match(checkTimeoutSrc, /preCommitGame\.status === 'completed' \|\| preCommitGame\.fen !== game\.fen/, 'checkTimeout re-validates immediately before committing');
assert.match(resignSrc, /preCommitGame\.status === 'completed'/, 'resignGame re-validates immediately before committing');
assert.match(respondDrawSrc, /action === 'cancel'/, 'respondDraw supports the offering player cancelling their own offer');
assert.match(respondDrawSrc, /preCommitGame\.draw_offered_by !== game\.draw_offered_by/, 'respondDraw re-validates the offer is still active immediately before committing');
assert.match(gameSchemaSrc, /draw_offered_by/, 'Game schema still carries draw_offered_by');

console.log('Game end-state race & draw-offer lifecycle validation passed.');
