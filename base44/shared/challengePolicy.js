// Shared, pure challenge rules. No provider requests, entity writes, or wallet mutations.
export const ENTRY_AMOUNT_GROUPS = [
  { label: 'Quick Play', amounts: [5, 10, 25] },
  { label: 'Popular', amounts: [50, 100, 250] },
  { label: 'High Value', amounts: [500, 1000, 2500] },
];
export const ENTRY_AMOUNTS = Object.freeze(ENTRY_AMOUNT_GROUPS.flatMap(group => group.amounts));
export function validNewEntry(value) {
  return (typeof value === 'number' || typeof value === 'string') && ENTRY_AMOUNTS.includes(Number(value));
}
export const CHALLENGE_VERSION = 1;
export const CHALLENGE_CREATION_VERSION = 'challenge-create-reserve-v3';
export const FAIR_PLAY_ATTESTATION_VERSION = 'match-fair-play-v1';
export const reservesOnCreation = match => match?.challenge_consent_version === CHALLENGE_CREATION_VERSION;
export const creatorReservationGroup = match => `match:${match.id}:challenge_creator_reservation:v1`;
export const creatorReleaseGroup = match => `match:${match.id}:challenge_creator_release:v1`;
export const creatorReservationLegs = match => challengeReservationLegs({...match, challenge_consent_version:''}, match.player1_id).slice(0,4);
export const creatorReleaseLegs = match => challengeReleaseLegs(match, match.player1_id).slice(0,4);
export const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
export const CHALLENGE_AUTHORIZATION_MS = 2 * 60 * 1000;
export const CHALLENGE_START_WINDOW_MS = 2 * 60 * 1000; // Historical accepted matches without a recorded deadline.
export const CHALLENGE_RETURN_WINDOW_MS = 5 * 60 * 1000;
export function challengeStartDeadline(match) {
  const explicit = Date.parse(match?.challenge_start_deadline_at || '');
  return Number.isFinite(explicit) ? explicit : Date.parse(match?.preparation_started_at || '') + CHALLENGE_START_WINDOW_MS;
}
export function challengeStartRemainingMs(match, now = Date.now()) {
  const remaining = challengeStartDeadline(match) - now;
  // A client clock behind the server must never display more than the
  // five-minute return window recorded by the backend.
  return Math.max(0, Math.min(CHALLENGE_RETURN_WINDOW_MS, remaining));
}
export const CHALLENGE_READY_MS = 30 * 1000;
export const CHALLENGE_HUD_CONSENT_VERSION = 'challenge-visible-hud-v2';
export const CHALLENGE_HUD_TERMS = 'I agree to the Official Rules and Fair Play requirements. While I keep this challenge open on the Play screen, I authorize my displayed Entry Amount and separate Platform Service Fee to be reserved if an eligible, funded opponent accepts. Creating the link reserves no money. Both players must confirm readiness before the game starts.';
export const CHALLENGE_NOT_RESERVED = 'This link remains open. Wallet setup and pending deposits do not reserve an opponent. Only available funds count; another eligible player may accept first.';
// Omitted timeControl preserves the original five-minute contract for older clients.
export const CHALLENGE_CLOCK_MS = 5 * 60 * 1000;
export const CHALLENGE_TIME_CONTROLS = [
  { value: 'blitz', label: 'Blitz', minutes: 3, displayName: 'Blitz (3+0)', clockMs: 180000 },
  { value: 'rapid', label: 'Rapid', minutes: 10, displayName: 'Rapid (10+0)', clockMs: 600000 },
  { value: 'classical', label: 'Classical', minutes: 15, displayName: 'Classical (15+0)', clockMs: 900000 },
];
export function challengeTimeControl(value) {
  if (value === undefined) return { value: 'blitz', displayName: 'Blitz (5+0)', clockMs: CHALLENGE_CLOCK_MS };
  return CHALLENGE_TIME_CONTROLS.find(control => control.value === value) || null;
}
export function challengeClockMs(match) {
  const control = challengeTimeControl(match.time_control);
  if (!control) throw new Error('invalid_challenge_time_control');
  const clock = match.clock_initial_ms ?? (match.time_control === 'blitz' ? CHALLENGE_CLOCK_MS : control.clockMs);
  if (clock !== control.clockMs && !(match.time_control === 'blitz' && clock === CHALLENGE_CLOCK_MS))
    throw new Error('invalid_challenge_clock');
  return clock;
}
export const CHALLENGE_OPEN_LIMIT = 1;
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
  // The creator already authorized and reserved funds at creation; being online
  // is required at game start, not when a recipient accepts the invitation.
  if (reservesOnCreation(match)) return Boolean(isFreeMatch(match) || match.player1_deposited);
  if (match?.challenge_consent_version === CHALLENGE_HUD_CONSENT_VERSION) {
    const consent = Date.parse(match.challenge_hud_consent_at || '');
    const until = Date.parse(match.challenge_authorized_until || '');
    return Boolean((reservesOnCreation(match) || match.player1_certified) && match.challenge_creator_presence_id &&
      Number.isFinite(consent) && consent <= now && Number.isFinite(until) && until > now && until - now <= CHALLENGE_READY_MS);
  }
  const at = Date.parse(match?.challenge_authorized_at || '');
  const until = Date.parse(match?.challenge_authorized_until || '');
  return Boolean(match?.player1_certified && match?.challenge_consent_version === CHALLENGE_CONSENT_VERSION &&
    Number.isFinite(at) && Number.isFinite(until) && at <= now && now < until && until > at && until - at <= CHALLENGE_AUTHORIZATION_MS);
}
export function challengeStartExpired(match, now = Date.now()) {
  const deadline = challengeStartDeadline(match);
  return !Number.isFinite(deadline) || now >= deadline;
}
export function bothChallengePlayersReady(match, now = Date.now()) {
  return ['player1', 'player2'].every(role => {
    const at = Date.parse(match?.[`challenge_${role}_ready_at`] || '');
    return Number.isFinite(at) && at <= now && now - at < CHALLENGE_READY_MS;
  });
}
export function publicChallenge(match, hostName = 'ChessBet player', now = Date.now()) {
  const open = match.status === 'searching' && !challengeExpired(match, now);
  const processing = ['reserving', 'releasing'].includes(match.challenge_operation_state);
  return {
    id: match.id,
    creatorName: hostName,
    playMode: isFreeMatch(match) ? 'free' : 'money',
    entryAmount: Number(match.wager_amount),
    serviceFee: Number(match.platform_service_fee),
    totalRequired: (cents(match.wager_amount) + cents(match.platform_service_fee)) / 100,
    winnerAward: cents(match.wager_amount) * 2 / 100,
    displayName: match.display_name,
    expiresAt: match.challenge_expires_at,
    status: processing ? 'processing' : open ? 'open' : match.challenge_close_reason === 'expired' ||
      (match.status === 'searching' && challengeExpired(match, now)) ? 'expired' :
      match.status === 'cancelled' ? 'cancelled' : match.status === 'completed' ? 'completed' : 'claimed',
    creatorConsentRequired: !reservesOnCreation(match) && match.challenge_consent_version !== CHALLENGE_HUD_CONSENT_VERSION,
    creatorFundsReserved: !isFreeMatch(match) && Boolean(match.player1_deposited),
    creatorPresenceRequired: !isFreeMatch(match) && !reservesOnCreation(match),
    creatorReady: open && !processing && creatorAuthorized(match, now),
    creatorReadyUntil: open && !processing ? match.challenge_authorized_until || null : null,
    publiclyListed: match.challenge_publicly_listed === true,
    isRematch: Boolean(match.challenge_rematch_of),
    // Never expose another player's balance, email, identity result, raw user ID, or location.
  };
}
// Both players' entry AND fee are committed in ONE existing LedgerJournalBatch.
// Transaction projections are created only after that batch commits.
export function challengeReservationLegs(match, recipientId) {
  if (isFreeMatch(match)) throw new Error('free_match_cannot_reserve');
  return (reservesOnCreation(match) ? [recipientId] : [match.player1_id, recipientId]).flatMap(userId => [
    { ledgerAccount: 'user_account', userId, debit: Number(match.wager_amount), credit: 0,
      heldDelta: Number(match.wager_amount), totalWageredDelta: Number(match.wager_amount), transactionType: 'match_entry' },
    { ledgerAccount: 'contest_clearing', debit: 0, credit: Number(match.wager_amount), transactionType: 'match_entry' },
    { ledgerAccount: 'user_account', userId, debit: Number(match.platform_service_fee), credit: 0,
      heldDelta: Number(match.platform_service_fee), transactionType: 'platform_fee' },
    { ledgerAccount: 'suspense', debit: 0, credit: Number(match.platform_service_fee), transactionType: 'platform_fee' },
  ]);
}
export function challengeReleaseLegs(match, recipientId) {
  if (isFreeMatch(match)) throw new Error('free_match_cannot_refund');
  return [match.player1_id, recipientId].flatMap(userId => [
    { ledgerAccount: 'contest_clearing', debit: Number(match.wager_amount), credit: 0, transactionType: 'refund' },
    { ledgerAccount: 'user_account', userId, debit: 0, credit: Number(match.wager_amount),
      heldDelta: -Number(match.wager_amount), totalWageredDelta: -Number(match.wager_amount), transactionType: 'refund' },
    { ledgerAccount: 'suspense', debit: Number(match.platform_service_fee), credit: 0, transactionType: 'refund' },
    { ledgerAccount: 'user_account', userId, debit: 0, credit: Number(match.platform_service_fee),
      heldDelta: -Number(match.platform_service_fee), transactionType: 'refund' },
  ]);
}

// Only a server-created explicit mode can select the free path. Legacy rows
// remain money matches. Zero entry alone never exempts a money match.
export const FREE_PLAY_TERMS = 'I agree to the Fair Play requirements for this free chess game.';
export const isFreeMatch = match => match?.play_mode === 'free';
export function assertFreeMatch(match) {
  if (!isChallenge(match) || !isFreeMatch(match) || match.wager_amount !== 0 ||
      match.platform_service_fee !== 0 || match.player1_deposited || match.player2_deposited ||
      match.challenge_reservation_group_id || match.challenge_release_group_id ||
      ['reserving','releasing','committed','released'].includes(match.challenge_operation_state))
    throw new Error('invalid_free_match');
  return true;
}