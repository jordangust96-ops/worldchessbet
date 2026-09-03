import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression test for Finding #8 from the full referential-integrity audit:
// ledger_group_id was crypto.randomUUID() at every match-related posting
// site (lockWager, cancelMatch, checkPreparationTimeout, closeAccount,
// settleMatch, manageDisputeCase) — an admin investigating a specific match
// or case had no way to find its ledger groups directly; they had to go
// through getIntegrationPacket (or a raw LedgerEntry scan by match_id) to
// even discover the opaque group ids in the first place.
//
// The fix replaces each of those group ids with a deterministic, greppable
// string built from data already unique to that exact financial event
// (match:<matchId>:<triggerEvent>:<walletTransactionId>, or
// dispute:<caseId>:<triggerEvent> for the two manageDisputeCase remedy
// postings) — never introducing a NEW collision risk, since a
// WalletTransaction id (or a once-only-resolvable DisputeCase id) was
// already guaranteed unique per event before this change.

// --- Model: uniqueness is inherited from the anchor id, not invented.
// Two distinct financial events for the SAME match (e.g. two different
// settlement attempts, or lock then later cancel) get distinct group ids
// because their WalletTransaction ids differ, even though the match id and
// trigger event are identical.
function ledgerGroupId(matchId, triggerEvent, walletTransactionId) {
  return `match:${matchId}:${triggerEvent}:${walletTransactionId}`;
}
{
  const a = ledgerGroupId('match-1', 'match_entry', 'txn-aaa');
  const b = ledgerGroupId('match-1', 'match_entry', 'txn-bbb'); // e.g. player 2's own entry leg
  assert.notEqual(a, b, 'two different WalletTransactions for the same match/event still get distinct group ids');
  assert.equal(a, 'match:match-1:match_entry:txn-aaa', 'the id is deterministic and reproducible from the same inputs — an admin can construct it directly, not just look it up');
}

// A DisputeCase can only reach a terminal resolution once (resolve_case
// refuses to act on an already-resolved/closed case), so caseId+triggerEvent
// alone is a safe unique anchor with no WalletTransaction available (a
// remedy can touch two different users' transactions in one balanced group).
function disputeGroupId(caseId, triggerEvent) {
  return `dispute:${caseId}:${triggerEvent}`;
}
{
  const reversed = disputeGroupId('case-1', 'contest_reversal');
  const voided = disputeGroupId('case-1', 'contest_void');
  assert.notEqual(reversed, voided, 'the same case reaching two different (mutually exclusive, but modeled independently here) resolution types would still get distinct group ids');
}

// --- Cross-check against the actual deployed source: every previously
// crypto.randomUUID() ledger_group_id site now uses the deterministic form,
// and none of the six functions named in the finding still use a random one.
const files = [
  'base44/functions/lockWager/entry.ts',
  'base44/functions/cancelMatch/entry.ts',
  'base44/functions/checkPreparationTimeout/entry.ts',
  'base44/functions/closeAccount/entry.ts',
  'base44/functions/settleMatch/entry.ts',
  'base44/functions/manageDisputeCase/entry.ts',
];
const contents = await Promise.all(files.map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8')));

for (const [file, src] of files.map((f, i) => [f, contents[i]])) {
  assert.doesNotMatch(src, /groupId: crypto\.randomUUID\(\)/, `${file} no longer posts any ledger group under an opaque random UUID`);
}

const [lockWagerSrc, cancelMatchSrc, prepTimeoutSrc, closeAccountSrc, settleMatchSrc, disputeSrc] = contents;

assert.match(lockWagerSrc, /groupId: `match:\$\{match\.id\}:match_entry:\$\{entryTransaction\.id\}`,/, 'lockWager posts the entry leg under a deterministic match_entry group id');
assert.match(lockWagerSrc, /groupId: `match:\$\{match\.id\}:service_fee_charge:\$\{feeTransaction\.id\}`,/, 'lockWager posts the fee leg under a deterministic service_fee_charge group id');

assert.match(cancelMatchSrc, /groupId: `match:\$\{match\.id\}:match_cancelled:\$\{entryTransaction\.id\}`,/, 'cancelMatch posts the refund leg under a deterministic group id');
assert.match(cancelMatchSrc, /groupId: `match:\$\{match\.id\}:service_fee_refund:\$\{feeTransaction\.id\}`,/, 'cancelMatch posts the fee refund leg under a deterministic group id');

assert.match(prepTimeoutSrc, /groupId: `match:\$\{match\.id\}:preparation_timeout:\$\{entryTransaction\.id\}`,/, 'checkPreparationTimeout posts the refund leg under a deterministic group id');

assert.match(closeAccountSrc, /groupId: `match:\$\{match\.id\}:account_closure_match_cancelled:\$\{walletTransaction\.id\}`,/, 'closeAccount posts the open-invitation refund leg under a deterministic group id');
// The withdrawal-reservation group id closeAccount already used before this
// fix (added earlier this engagement) must remain intact.
assert.match(closeAccountSrc, /`seamless:withdrawal:reserve:\$\{walletTransaction\.id\}`/, "closeAccount's Seamless withdrawal reservation group id convention is unaffected by this change");

assert.match(settleMatchSrc, /groupId: `match:\$\{match\.id\}:match_settlement_draw:\$\{entryTransaction\.id\}`,/, 'settleMatch posts the draw refund leg under a deterministic group id');
assert.match(settleMatchSrc, /groupId: `match:\$\{match\.id\}:match_settlement:\$\{walletTransaction\.id\}`,/, 'settleMatch posts the decisive winner/loser settlement legs under a deterministic group id');

assert.match(disputeSrc, /const groupId = explicitGroupId \|\| crypto\.randomUUID\(\);/, 'postRemedyLegs accepts a caller-supplied deterministic group id, falling back to random only if none is given');
assert.match(disputeSrc, /groupId: `dispute:\$\{disputeCase\.id\}:contest_reversal`,/, "contest_reversed's remedy legs are posted under a deterministic dispute-case group id");
assert.match(disputeSrc, /groupId: `dispute:\$\{disputeCase\.id\}:contest_void`,/, "contest_voided's remedy legs are posted under a deterministic dispute-case group id");

console.log('Deterministic ledger_group_id validation passed.');
