// Integer-cent funding provenance. Stored with each immutable journal batch.
// A mixed-funded prize inherits every unexpired source deadline in full.
// Unspent unrelated wallet lots remain independently withdrawable.
export const FUNDING_POLICY_VERSION = 1;
export function cents(value) {
  const n = Number(value || 0), c = Math.round(n * 100);
  if (!Number.isFinite(n) || Math.abs(n * 100 - c) > 0.00001) throw new Error('invalid_funding_amount');
  return c;
}
export function heldBucket(matchId, transactionId) {
  return matchId ? 'match:' + matchId : transactionId ? 'tx:' + transactionId : 'general';
}
export function sourceState(tx, now = Date.now()) {
  if (!tx || tx.type !== 'deposit') return 'blocked';
  if (['failed', 'reversed'].includes(tx.status) || tx.deposit_hold_status === 'returned' || tx.deposit_withdrawal_status === 'returned') return 'blocked';
  const at = Date.parse(tx.deposit_release_at || '');
  return tx.status === 'completed' && tx.deposit_withdrawal_status === 'released' &&
    Number.isFinite(at) && at <= now && String(tx.provider_last_status || '').toLowerCase() === 'processed'
      ? 'clear' : 'held';
}
function compact(lots) {
  const out = new Map();
  for (const lot of lots) {
    if (!Number.isSafeInteger(lot.cents) || lot.cents < 0) throw new Error('invalid_funding_lot');
    if (!lot.cents) continue;
    const sources = [...new Set(lot.sources || [])].sort();
    const key = JSON.stringify(sources);
    const saved = out.get(key) || { cents: 0, sources };
    saved.cents += lot.cents;
    out.set(key, saved);
  }
  return [...out.values()];
}
export function normalizeState(state, sources, now = Date.now()) {
  const result = structuredClone(state || { available: [], held: {} });
  const normalize = lots => compact(lots.map(lot => ({
    ...lot, sources: lot.sources.filter(id => sourceState(sources[id], now) !== 'clear'),
  })));
  result.available = normalize(result.available);
  for (const key of Object.keys(result.held)) result.held[key] = normalize(result.held[key]);
  return result;
}
export function fundingSummary(state, sources, now = Date.now()) {
  let available = 0, withdrawable = 0, blocked = 0, next = null;
  for (const lot of state.available) {
    available += lot.cents;
    const active = lot.sources.filter(id => sourceState(sources[id], now) !== 'clear');
    if (!active.length) withdrawable += lot.cents;
    if (active.some(id => sourceState(sources[id], now) === 'blocked')) blocked += lot.cents;
    for (const id of active) {
      const at = Date.parse(sources[id]?.deposit_release_at || '');
      if (Number.isFinite(at) && at > now && (next === null || at < next)) next = at;
    }
  }
  return {
    available_to_play: (available - blocked) / 100,
    available_to_withdraw: withdrawable / 100,
    withdrawal_restricted_balance: (available - withdrawable) / 100,
    return_restricted_balance: blocked / 100,
    next_withdrawal_review_at: next === null ? null : new Date(next).toISOString(),
  };
}
function take(lots, amount, withdrawal, sources, now) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('invalid_funding_amount');
  // For play, use held deposits before unrestricted money. Bank withdrawals
  // may consume only unrestricted lots, including any associated fee.
  lots.sort((a, b) => withdrawal ? a.sources.length - b.sources.length : b.sources.length - a.sources.length);
  const consumed = [];
  for (const lot of lots) {
    if (!amount) break;
    if (withdrawal && lot.sources.length) continue;
    const used = Math.min(lot.cents, amount);
    if (used) consumed.push({ cents: used, sources: [...lot.sources] });
    lot.cents -= used;
    amount -= used;
  }
  if (amount) throw new Error(withdrawal ? 'ach_withdrawal_hold' : 'funding_provenance_insufficient');
  return consumed;
}
export function transitionFunding(states, legs, context, sources, now = Date.now()) {
  const next = Object.fromEntries(Object.entries(states).map(([id, state]) => [id, normalizeState(state, sources, now)]));
  const inputs = {}, outputs = [];
  const withdrawal = context.triggerEvent === 'withdrawal_reservation' || context.triggerEvent === 'withdrawal_fee';
  for (const leg of legs.filter(l => l.ledgerAccount === 'user_account')) {
    const state = next[leg.userId];
    if (!state) throw new Error('funding_state_missing');
    const available = Number.isFinite(leg.availableDelta) ? cents(leg.availableDelta) : cents(leg.credit) - cents(leg.debit);
    // creditHeld must remain separate from heldDelta: settlement consumes
    // the winner's reservation and credits a different (larger) prize.
    const held = cents(leg.heldDelta), creditHeld = cents(leg.creditHeld);
    const bucket = heldBucket(context.matchId, leg.walletTransactionId || context.walletTransactionId);
    state.held[bucket] ||= [];
    const consumed = inputs[leg.userId] ||= [];
    if (available < 0) consumed.push(...take(state.available, -available, withdrawal, sources, now));
    if (held < 0) consumed.push(...take(state.held[bucket], -held, false, sources, now));
    if (available > 0) outputs.push({ userId: leg.userId, target: state.available, amount: available });
    if (held > 0) outputs.push({ userId: leg.userId, target: state.held[bucket], amount: held });
    if (creditHeld > 0) outputs.push({ userId: leg.userId, target: state.held[bucket], amount: creditHeld });
  }
  const allSources = [...new Set(Object.values(inputs).flat().flatMap(lot => lot.sources))];
  const matchSources = (context.matchSources || []).filter(id => sourceState(sources[id], now) !== 'clear');
  if (context.captureSources) context.captureSources([...new Set([...matchSources, ...allSources])]);
  const crossUser = outputs.some(output => output.amount > (inputs[output.userId] || []).reduce((sum, lot) => sum + lot.cents, 0));
  const spending = ['challenge_reservation', 'match_entry', 'wager_lock', 'service_fee_charge', 'withdrawal_reservation', 'withdrawal_fee'].includes(context.triggerEvent);
  if (spending && allSources.some(id => sourceState(sources[id], now) === 'blocked')) throw new Error('ach_return_review_required');
  for (const output of outputs) {
    const inherited = crossUser ? [...new Set([...allSources, ...matchSources])] : [...new Set((inputs[output.userId] || []).flatMap(lot => lot.sources))];
    const origin = context.triggerEvent === 'deposit_availability_release' ? [context.walletTransactionId] : [];
    output.target.push({ cents: output.amount, sources: [...new Set([...inherited, ...origin])] });
  }
  for (const state of Object.values(next)) {
    state.available = compact(state.available);
    for (const key of Object.keys(state.held)) {
      state.held[key] = compact(state.held[key]);
      if (!state.held[key].length) delete state.held[key];
    }
  }
  return next;
}
