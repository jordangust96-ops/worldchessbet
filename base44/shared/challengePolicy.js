// Shared, pure challenge rules. No provider requests, entity writes, or wallet mutations.
export const CHALLENGE_VERSION = 2;
export const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
export const CHALLENGE_AUTHORIZATION_MS = 90 * 1000;
export const CHALLENGE_START_WINDOW_MS = 2 * 60 * 1000;
export const CHALLENGE_READY_MS = 30 * 1000;
export const CHALLENGE_CLOCK_MS = 5 * 60 * 1000;
export const CHALLENGE_OPEN_LIMIT = 5;
export const CHALLENGE_CONSENT_VERSION = 'challenge-dual-reservation-v1';
export const CHALLENGE_TERMS = 'I agree to the Official Rules and Fair Play requirements. I authorize my displayed Entry Amount and separate Platform Service Fee to be reserved together with the first eligible, funded opponent while I am ready. Creating or sharing this link alone does not reserve funds.';
export const VALID_INVITE = /^[a-f0-9]{32}$/;
export const VALID_REQUEST_KEY = /^[a-zA-Z0-9_-]{16,80}$/;
export const cents = value => Math.round(Number(value) * 100);
export const isChallenge = match => Number(match?.challenge_version) === CHALLENGE_VERSION && match?.is_private === true;
export const reservationGroup = match => `match:${match.id}:challenge_reservation:v1`;
export const refundGroup = match => `match:${match.id}:challenge_release:v1`;
export const challengePath = code => `/challenge/${code}`;
export function validEntry(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 5 && n <= 5000 && Math.abs(n * 100 - Math.round(n * 100)) < 0.000001;
}
export function challengeExpired(match, now = Date.now()) {
  const expiry = Date.parse(match?.challenge_expires_at || '');
  return !Number.isFinite(expiry) || now >= expiry;
}
export function creatorAuthorized(match, now = Date.now()) {
  const at = Date.parse(match?.challenge_creator_consent_at || '');
  const until = Date.parse(match?.challenge_creator_ready_until || '');
  return Boolean(match?.player1_certified && match?.challenge_consent_version === CHALLENGE_CONSENT_VERSION &&
    Number.isFinite(at) && at <= now && now < until && until - at <= CHALLENGE_AUTHORIZATION_MS);
}
export function challengeStartExpired(match, now = Date.now()) {
  const at = Date.parse(match?.preparation_started_at || '');
  return !Number.isFinite(at) || now >= at + CHALLENGE_START_WINDOW_MS;
}
export function bothChallengePlayersReady(match, now = Date.now()) {
  return ['player1', 'player2'].every(role => {
    const until = Date.parse(match?.[`challenge_${role}_ready_until`] || '');
    return Number.isFinite(until) && until > now && until <= now + CHALLENGE_READY_MS;
  });
}
export function publicChallenge(match, hostName = 'ChessBet player', now = Date.now()) {
  const open = match.status === 'searching' && !challengeExpired(match, now);
  const processing = ['reserving', 'releasing'].includes(match.challenge_commit_state);
  return {
    id: match.id,
    creatorName: hostName,
    entryAmount: Number(match.wager_amount),
    serviceFee: Number(match.platform_service_fee),
    totalRequired: (cents(match.wager_amount) + cents(match.platform_service_fee)) / 100,
    winnerAward: cents(match.wager_amount) * 2 / 100,
    displayName: match.display_name,
    expiresAt: match.challenge_expires_at,
    status: processing ? 'processing' : open ? 'open' : match.challenge_close_reason === 'expired' ||
      (match.status === 'searching' && challengeExpired(match, now)) ? 'expired' :
      match.status === 'cancelled' ? 'cancelled' : match.status === 'completed' ? 'completed' : 'claimed',
    creatorReady: open && !processing && creatorAuthorized(match, now),
    // Never expose another player's balance, email, identity result, raw user ID, or location.
  };
}
// Both players' entry AND fee are committed in ONE existing LedgerJournalBatch.
// Transaction projections are created only after that batch commits.
export function challengeReservationLegs(match, recipientId) {
  return [match.player1_id, recipientId].flatMap(userId => [
    { ledgerAccount: 'user_account', userId, debit: Number(match.wager_amount), credit: 0,
      heldDelta: Number(match.wager_amount), totalWageredDelta: Number(match.wager_amount), transactionType: 'match_entry' },
    { ledgerAccount: 'contest_clearing', debit: 0, credit: Number(match.wager_amount), transactionType: 'match_entry' },
    { ledgerAccount: 'user_account', userId, debit: Number(match.platform_service_fee), credit: 0,
      heldDelta: Number(match.platform_service_fee), transactionType: 'platform_fee' },
    { ledgerAccount: 'suspense', debit: 0, credit: Number(match.platform_service_fee), transactionType: 'platform_fee' },
  ]);
}
export function challengeReleaseLegs(match, recipientId) {
  return [match.player1_id, recipientId].flatMap(userId => [
    { ledgerAccount: 'contest_clearing', debit: Number(match.wager_amount), credit: 0, transactionType: 'refund' },
    { ledgerAccount: 'user_account', userId, debit: 0, credit: Number(match.wager_amount),
      heldDelta: -Number(match.wager_amount), totalWageredDelta: -Number(match.wager_amount), transactionType: 'refund' },
    { ledgerAccount: 'suspense', debit: Number(match.platform_service_fee), credit: 0, transactionType: 'refund' },
    { ledgerAccount: 'user_account', userId, debit: 0, credit: Number(match.platform_service_fee),
      heldDelta: -Number(match.platform_service_fee), transactionType: 'refund' },
  ]);
}
