import { allLedgerRows } from './ledgerPagination.ts';
import { cents, heldBucket, transitionFunding, fundingSummary } from './fundingProvenancePure.js';

export async function readFundingState(base44, userId) {
  const batches = await base44.asServiceRole.entities.LedgerJournalBatch.filter(
    { launch_epoch: 2, funding_user_ids: { $in: [userId] } }, '-funding_sequence', 1);
  if (batches[0]) {
    const saved = JSON.parse(batches[0].funding_provenance_json);
    if (saved.version !== 1 || !saved.users[userId]) throw new Error('invalid_funding_provenance');
    return saved.users[userId];
  }
  // Bootstrap only historical money. Earlier play cannot begin until the
  // central journal writer records the deposit-release source atomically.
  const entries = await allLedgerRows(base44.asServiceRole.entities.LedgerEntry, { launch_epoch: 2, user_id: userId });
  let available = 0;
  const held = {};
  for (const entry of entries) {
    available += entry.available_delta == null ? cents(entry.credit_amount) - cents(entry.debit_amount) : cents(entry.available_delta);
    const key = heldBucket(entry.match_id, entry.wallet_transaction_id);
    held[key] = (held[key] || 0) + cents(entry.held_delta);
  }
  if (available < 0 || Object.values(held).some(n => n < 0)) throw new Error('legacy_funding_provenance_requires_review');
  return { available: available ? [{ cents: available, sources: [] }] : [],
    held: Object.fromEntries(Object.entries(held).filter(([,n]) => n > 0).map(([key,n]) => [key,[{ cents:n,sources:[] }]])) };
}
export async function readFundingSources(base44, states) {
  const ids = [...new Set(Object.values(states).flatMap(state =>
    [...state.available, ...Object.values(state.held).flat()].flatMap(lot => lot.sources)))];
  const sources = {};
  for (const id of ids) sources[id] = await base44.asServiceRole.entities.WalletTransaction.get(id);
  return sources;
}
export async function walletFundingSummary(base44, userId) {
  const state = await readFundingState(base44, userId);
  const sources = await readFundingSources(base44, { [userId]: state });
  return fundingSummary(state, sources);
}
// Called only within the shared global ledger lease, before the single
// immutable batch commit. Snapshot and monetary legs commit together.
export async function prepareFundingCommit(base44, legs, context) {
  const userIds = [...new Set(legs.map(leg => leg.userId).filter(Boolean))];
  if (!userIds.length) return {};
  const states = {};
  for (const userId of userIds) {
    const state = states[userId] = await readFundingState(base44, userId);
    const wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: userId }))[0];
    const available = state.available.reduce((n, lot) => n + lot.cents, 0);
    const held = Object.values(state.held).flat().reduce((n, lot) => n + lot.cents, 0);
    if (available !== cents(wallet?.available_balance) || held !== cents(wallet?.held_balance)) throw new Error('funding_projection_recovery_required');
  }
  const sources = await readFundingSources(base44, states);
  if (context.triggerEvent === 'withdrawal_reservation') {
    for (const userId of userIds) {
      const amount = legs.filter(leg => leg.userId === userId).reduce((sum, leg) => sum + Number(leg.debit || 0), 0);
      if (fundingSummary(states[userId], sources).available_to_withdraw + 0.001 < amount + Number(context.withdrawalFee || 0)) throw new Error('ach_withdrawal_hold');
    }
  }
  const users = transitionFunding(states, legs, context, sources);
  const latest = (await base44.asServiceRole.entities.LedgerJournalBatch.filter(
    { launch_epoch: 2, funding_sequence: { $gt: 0 } }, '-funding_sequence', 1))[0];
  return {
    funding_user_ids: userIds,
    funding_sequence: Number(latest?.funding_sequence || 0) + 1,
    funding_provenance_json: JSON.stringify({ version: 1, users }),
  };
}
