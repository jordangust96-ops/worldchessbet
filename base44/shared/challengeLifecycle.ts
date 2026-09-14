import { postLedgerLegs } from './ledger.ts';
import { sha256Hex } from './mfaCore.js';
import { recordIntegrationEvent } from './integrationEvents.ts';
import { verifyMatchLocation, getMatchLocationReadiness } from './matchLocation.ts';
import { hasVerifiedIdentity } from './identityEligibility.js';
import { getPlatformServiceFee, PLATFORM_FEE_SCHEDULE_VERSION } from './platformFee.ts';
import { paidContestsEnabled } from './seamlessFundingConfig.ts';
import { acquireMatchLock, releaseMatchLock, acquireUserWalletLock, releaseUserWalletLock,
  setChallengeWalletBarriers, clearChallengeWalletBarriers, takeChallengeRateLimit, refreshContestLocks } from './seamlessAtomicStore.ts';
import { CHALLENGE_VERSION, CHALLENGE_TTL_MS, CHALLENGE_AUTHORIZATION_MS, CHALLENGE_CLOCK_MS,
  CHALLENGE_OPEN_LIMIT, CHALLENGE_CONSENT_VERSION, VALID_INVITE, VALID_REQUEST_KEY,
  validEntry, isChallenge, challengeExpired, creatorAuthorized, challengeStartExpired,
  bothChallengePlayersReady, publicChallenge, reservationGroup, refundGroup,
  challengeReservationLegs, challengeReleaseLegs, challengePath } from './challengePolicy.js';
import { fail, requireChallengePlayer, requireChallengePolicies, inspectChallengePlayer } from './challengeAccess.ts';

const OPERATION_RECOVERY_MS = 3 * 60 * 1000;
const activeOperation = (m: any) => ['reserving', 'releasing'].includes(m.challenge_operation_state);
const nowIso = () => new Date().toISOString();
const roleFor = (match: any, userId: string) => match.player1_id === userId ? 'player1' : match.player2_id === userId ? 'player2' : '';
const publicName = (user: any) => String(user?.chess_com_username || '').trim().slice(0, 50) || 'ChessBet player';

export async function challengeEvent(base44: any, match: any, event: string, userId: string, result = '', suffix = '') {
  // Reuses IntegrationEvent. These are product/audit events, NOT ledger transactions.
  await recordIntegrationEvent(base44, { eventType: `challenge.${event}`, aggregateType: 'match', aggregateId: match.id,
    correlationId: match.id, idempotencyKey: `challenge.${event}:${match.id}:${userId}:${suffix}`,
    actorType: userId ? 'user' : 'system', actorId: userId || '', userId: userId || match.player1_id,
    counterpartyUserId: userId === match.player1_id ? match.player2_id || '' : match.player1_id,
    matchId: match.id, status: match.status, amount: Number(match.wager_amount), result,
    eventData: { challenge_version: CHALLENGE_VERSION, is_private: true, fee: match.platform_service_fee } });
}

async function underMatchLock(base44: any, id: string, fn: (m: any, owner: string) => Promise<any>) {
  const owner = crypto.randomUUID();
  if (!await acquireMatchLock(id, owner)) fail('busy', 'This challenge is updating. Please try again.', 409);
  let leaseLost = false;
  const keepLease = async () => {
    if (leaseLost || !await refreshContestLocks(id, [], owner)) {
      leaseLost = true; throw new Error('challenge_lease_lost');
    }
  };
  const timer = setInterval(() => { keepLease().catch(() => { leaseLost = true; }); }, 20000);
  try {
    const match = await base44.asServiceRole.entities.Match.get(id);
    if (!isChallenge(match) || Number(match.launch_epoch) !== 2) fail('unavailable', 'This challenge is not available.', 404);
    await keepLease();
    return await fn(match, owner);
  } finally { clearInterval(timer); await releaseMatchLock(id, owner).catch(() => {}); }
}
async function underWalletLocks(userIds: string[], owner: string, matchId: string, fn: () => Promise<any>) {
  const locked: string[] = [];
  try {
    for (const id of [...new Set(userIds)].sort()) {
      if (!await acquireUserWalletLock(id, owner, matchId)) fail('wallet_busy', 'A wallet is updating. Please try again.', 409);
      locked.push(id);
    }
    const timer = setInterval(() => {
      refreshContestLocks(matchId, locked, owner).catch(() => false);
    }, 20000);
    try { return await fn(); } finally { clearInterval(timer); }
  } finally { for (const id of locked.reverse()) await releaseUserWalletLock(id, owner).catch(() => {}); }
}
async function batchFor(base44: any, groupId: string) {
  const rows = await base44.asServiceRole.entities.LedgerJournalBatch.filter({ ledger_group_id: groupId }, '-created_at', 2);
  if (rows.length > 1) throw new Error('duplicate_challenge_journal');
  return rows[0] || null;
}

export async function resolveChallenge(base44: any, inviteCode: unknown) {
  if (typeof inviteCode !== 'string' || !VALID_INVITE.test(inviteCode)) fail('unavailable', 'This challenge is not available.', 404);
  const rows = await base44.asServiceRole.entities.Match.filter({ launch_epoch: 2, invite_code: inviteCode }, '-created_date', 2);
  if (rows.length !== 1 || !isChallenge(rows[0])) fail('unavailable', 'This challenge is not available.', 404);
  return rows[0];
}

export async function viewChallenge(base44: any, match: any, user: any) {
  const host = await base44.asServiceRole.entities.User.get(match.player1_id);
  const card = publicChallenge(match, publicName(host));
  const role = user ? roleFor(match, user.id) : '';
  return { challenge: card, role, participant: Boolean(role),
    // A signed-in claimant can resume a lost response; no other identity is exposed.
    ownOperation: Boolean(user && match.challenge_claimant_id === user.id && activeOperation(match)) };
}

export async function createChallenge(base44: any, user: any, body: any) {
  if (!paidContestsEnabled()) fail('paid_contests_disabled', 'Money challenges are temporarily unavailable.');
  if (!validEntry(body.entryAmount)) fail('invalid_entry', 'Choose an Entry Amount from $5 to $5,000, in whole cents.', 400);
  if (!VALID_REQUEST_KEY.test(String(body.requestKey || ''))) fail('invalid_request', 'Please refresh and try again.', 400);
  await requireChallengePolicies(base44, user.id);
  const owner = crypto.randomUUID();
  const lockId = `challenge-creation:${user.id}`;
  if (!await acquireMatchLock(lockId, owner)) fail('busy', 'A challenge is being created. Please try again.');
  try {
    const existing = await base44.asServiceRole.entities.Match.filter({
      launch_epoch: 2, player1_id: user.id, challenge_creation_key: body.requestKey,
    }, '-created_date', 2);
    if (existing.length) {
      if (Number(existing[0].wager_amount) !== Number(body.entryAmount) || (existing[0].challenge_rematch_of || '') !== (body.rematchOf || ''))
        fail('request_conflict', 'This request already created a challenge with different terms. Start a new request.');
      return { match: existing[0], inviteCode: existing[0].invite_code, path: challengePath(existing[0].invite_code) };
    }
    const open = await base44.asServiceRole.entities.Match.filter({ launch_epoch: 2, player1_id: user.id,
      challenge_version: CHALLENGE_VERSION, status: 'searching' }, '-created_date', 100);
    if (open.filter((m: any) => !challengeExpired(m) || activeOperation(m)).length >= CHALLENGE_OPEN_LIMIT)
      fail('open_limit', `You can have up to ${CHALLENGE_OPEN_LIMIT} open challenge links. Cancel an old link first.`);
    if (!await takeChallengeRateLimit(`create:${user.id}`, 20, 3600)) fail('rate_limited', 'Please wait before creating more challenges.', 429);
    let rematchOf = '';
    let targetId = '';
    if (body.rematchOf) {
      const previous = await base44.asServiceRole.entities.Match.get(String(body.rematchOf));
      if (!previous || Number(previous.launch_epoch) !== 2 || previous.status !== 'completed' || !roleFor(previous, user.id))
        fail('invalid_rematch', 'Choose a completed match from your own history.', 403);
      rematchOf = previous.id;
      targetId = previous.player1_id === user.id ? previous.player2_id : previous.player1_id;
    }
    const code = crypto.randomUUID().replaceAll('-', '');
    const createdAt = nowIso();
    const match = await base44.asServiceRole.entities.Match.create({
      launch_epoch: 2, player1_id: user.id, wager_amount: Number(body.entryAmount),
      platform_service_fee: getPlatformServiceFee(Number(body.entryAmount)), platform_fee_schedule_version: PLATFORM_FEE_SCHEDULE_VERSION,
      time_control: 'blitz', display_name: 'Blitz (5+0)', clock_initial_ms: CHALLENGE_CLOCK_MS,
      status: 'searching', is_private: true, invite_code: code, challenge_version: CHALLENGE_VERSION,
      challenge_creation_key: body.requestKey, challenge_location_started_at: createdAt,
      challenge_rematch_of: rematchOf, challenge_target_id: targetId,
      challenge_expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      challenge_operation_state: 'idle', player1_deposited: false, player2_deposited: false,
      player1_certified: false, player2_certified: false, notify_on_accept: true,
    });
    await challengeEvent(base44, match, 'created', user.id, 'invitation_only');
    return { match, inviteCode: code, path: challengePath(code) };
  } finally { await releaseMatchLock(lockId, owner).catch(() => {}); }
}

export async function listMyChallenges(base44: any, user: any) {
  const rows = await base44.asServiceRole.entities.Match.filter({ launch_epoch: 2, player1_id: user.id,
    challenge_version: CHALLENGE_VERSION, status: { $in: ['searching', 'preparing', 'both_ready', 'in_progress', 'cancelling'] } }, '-created_date', 100);
  return { challenges: rows.filter((m: any) => m.status !== 'searching' || !challengeExpired(m) || activeOperation(m)).map((m: any) => ({
    ...publicChallenge(m, publicName(user)), inviteCode: m.invite_code, path: challengePath(m.invite_code),
  })) };
}

export async function authorizeChallenge(req: Request, base44: any, user: any, match: any, body: any) {
  if (match.player1_id !== user.id) fail('forbidden', 'Only the creator can enable acceptance.', 403);
  if (body.agree !== true || Number(body.entryAmount) !== Number(match.wager_amount) || Number(body.serviceFee) !== Number(match.platform_service_fee))
    fail('consent_required', 'Review and agree to the displayed entry, fee, and Fair Play requirements.', 400);
  return underMatchLock(base44, match.id, async (fresh) => {
    if (fresh.status !== 'searching' || challengeExpired(fresh) || activeOperation(fresh)) fail('unavailable', 'This challenge is no longer open.');
    if (Number(body.entryAmount) !== Number(fresh.wager_amount) || Number(body.serviceFee) !== Number(fresh.platform_service_fee))
      fail('terms_changed', 'The challenge terms changed. Review them again before authorizing.', 409);
    await requireChallengePlayer(base44, user.id, fresh);
    const location = await verifyMatchLocation(req, fresh, body);
    if (location.status !== 'approved') fail('location_required', location.reason || 'Verify your location before playing.', 403);
    const updated = await base44.asServiceRole.entities.Match.update(fresh.id, {
      challenge_authorized_at: nowIso(), challenge_authorized_until: new Date(Date.now() + CHALLENGE_AUTHORIZATION_MS).toISOString(),
      challenge_consent_version: CHALLENGE_CONSENT_VERSION, player1_certified: true, player1_certified_at: nowIso(),
    });
    await challengeEvent(base44, updated, 'creator_ready', user.id, 'no_funds_reserved', updated.challenge_authorized_at);
    return { challenge: publicChallenge(updated, publicName(user)), authorizedUntil: updated.challenge_authorized_until };
  });
}

// Financial transaction rows are materialized AFTER the atomic batch exists.
// Abandoned onboarding, declined races, and failed gates never create fake transactions.
async function materializeChallengeTransactions(base44: any, match: any, recipientId: string, release = false) {
  const groupId = release ? refundGroup(match) : reservationGroup(match);
  for (const userId of [match.player1_id, recipientId]) {
    for (const fee of [false, true]) {
      const idempotencyKey = `${groupId}:${userId}:${fee ? 'fee' : 'entry'}`;
      const found = await base44.asServiceRole.entities.WalletTransaction.filter({ idempotency_key: idempotencyKey }, '-created_date', 2);
      if (found.length > 1) throw new Error('duplicate_challenge_transaction');
      if (found.length) continue;
      const retention = new Date(); retention.setUTCFullYear(retention.getUTCFullYear() + 2);
      await base44.asServiceRole.entities.WalletTransaction.create({
        launch_epoch: 2, user_id: userId, match_id: match.id,
        type: release ? fee ? 'service_fee_refund' : 'wager_refund' : fee ? 'service_fee_charge' : 'wager_lock',
        amount: Number(fee ? match.platform_service_fee : match.wager_amount), status: 'completed', currency: 'USD',
        direction: release ? 'release' : 'reserve', correlation_id: match.id, ledger_group_id: groupId,
        source_event: release ? 'challenge_release' : 'challenge_reservation', initiating_actor: release ? 'system' : 'user',
        initiating_actor_id: release ? '' : recipientId, processed_at: nowIso(), retention_until: retention.toISOString(),
        integration_status: 'internal_complete', idempotency_key: idempotencyKey, schema_version: 2,
        description: `${fee ? 'Platform service fee' : 'Contest entry amount'} ${release ? 'released — challenge did not start' : 'reserved — challenge accepted'}`,
      });
    }
  }
}

async function finishReservation(base44: any, match: any, owner: string, beforeCommit: null | (() => Promise<boolean>) = null) {
  const recipientId = match.challenge_claimant_id;
  if (!recipientId || recipientId === match.player1_id) throw new Error('invalid_challenge_claimant');
  const ids = [match.player1_id, recipientId];
  if (!await setChallengeWalletBarriers(ids, owner, match.id)) fail('wallet_busy', 'Wallet recovery is in progress.');
  await postLedgerLegs(base44, {
    groupId: reservationGroup(match), matchId: match.id, actor: 'user', actorId: recipientId,
    triggerEvent: 'challenge_reservation', externalRefType: 'match', externalRefId: match.id,
    legs: challengeReservationLegs(match, recipientId), updateTransactions: false,
    beforePost: async () => {
      if (!await refreshContestLocks(match.id, ids, owner)) throw new Error('challenge_lease_lost');
      return beforeCommit ? await beforeCommit() : true;
    },
    afterPost: async () => {
      await materializeChallengeTransactions(base44, match, recipientId);
      await base44.asServiceRole.entities.Match.update(match.id, {
        player2_id: recipientId, player1_deposited: true, player2_deposited: true,
        player2_certified: true, player2_certified_at: match.challenge_recipient_consent_at,
        player1_funding_operation_id: reservationGroup(match), player2_funding_operation_id: reservationGroup(match),
        acceptance_operation_id: reservationGroup(match), challenge_reservation_group_id: reservationGroup(match),
        // Keep the recoverable marker until BOTH wallet barriers have been
        // cleared. A failure clearing one barrier must remain sweep-visible.
        challenge_operation_state: 'reserving', status: 'preparing',
        preparation_started_at: match.challenge_operation_started_at,
        challenge_claimed_at: match.challenge_operation_started_at,
      });
    },
  });
  await clearChallengeWalletBarriers(ids, match.id);
  const updated = await base44.asServiceRole.entities.Match.update(match.id, { challenge_operation_state: 'committed' });
  await challengeEvent(base44, updated, 'claimed', recipientId, 'both_entries_and_fees_reserved');
  return { match: updated, accepted: true };
}

// Caller holds the match AND both wallet leases. The batch, not a response or
// a mutable status flag, decides whether a financial commitment happened.
async function recoverReservation(base44: any, match: any, owner: string) {
  const committed = await batchFor(base44, reservationGroup(match));
  if (committed) return finishReservation(base44, match, owner);
  if (Date.now() - Date.parse(match.challenge_operation_started_at || '') < OPERATION_RECOVERY_MS)
    return { processing: true, message: 'Confirming the reservation result. Do not submit another payment.' };
  await clearChallengeWalletBarriers([match.player1_id, match.challenge_claimant_id].filter(Boolean), match.id);
  const updated = await base44.asServiceRole.entities.Match.update(match.id, {
    challenge_operation_state: 'idle', challenge_claimant_id: '', challenge_operation_started_at: '',
  });
  return { recovered: true, accepted: false, challenge: publicChallenge(updated) };
}

export async function acceptChallenge(req: Request, base44: any, user: any, match: any, body: any) {
  if (match.player1_id === user.id) fail('own_challenge', 'You cannot accept your own challenge.', 400);
  if (body.agree !== true || Number(body.entryAmount) !== Number(match.wager_amount) || Number(body.serviceFee) !== Number(match.platform_service_fee))
    fail('consent_required', 'Review and agree to the displayed entry, fee, and Fair Play requirements.', 400);
  if (match.challenge_target_id && match.challenge_target_id !== user.id)
    fail('different_opponent', 'This rematch invitation is for the previous opponent.', 403);
  return underMatchLock(base44, match.id, async (fresh, owner) => {
    if (activeOperation(fresh)) {
      if (fresh.challenge_claimant_id !== user.id) fail('busy', 'Another eligible player is completing acceptance.');
      return underWalletLocks([fresh.player1_id, user.id], owner, fresh.id, async () =>
        fresh.challenge_operation_state === 'reserving' ? recoverReservation(base44, fresh, owner) : { processing: true });
    }
    if (fresh.player2_id === user.id && ['preparing', 'both_ready', 'in_progress', 'completed'].includes(fresh.status))
      return { match: fresh, accepted: true, replay: true };
    if (fresh.status !== 'searching' || challengeExpired(fresh)) fail('unavailable', 'This challenge has already been claimed, cancelled, or expired.');
    if (Number(body.entryAmount) !== Number(fresh.wager_amount) || Number(body.serviceFee) !== Number(fresh.platform_service_fee))
      fail('terms_changed', 'The challenge terms changed. Review them again before accepting.', 409);
    if (fresh.challenge_target_id && fresh.challenge_target_id !== user.id)
      fail('different_opponent', 'This rematch is for the previous opponent.', 403);
    await requireChallengePlayer(base44, user.id, fresh);
    await requireChallengePlayer(base44, fresh.player1_id, fresh, true);
    if (!creatorAuthorized(fresh)) fail('creator_not_ready', 'The creator needs to confirm they are ready. This link remains open; neither wallet is reserved.');
    const location = await verifyMatchLocation(req, fresh, body);
    if (location.status !== 'approved') fail('location_required', location.reason || 'Verify your location to accept.', 403);
    const candidate = { ...fresh, player2_id: user.id };
    if (!(await getMatchLocationReadiness(base44, candidate)).ready)
      fail('creator_not_ready', 'Both players need current location checks. Ask the creator to confirm readiness.');
    return underWalletLocks([fresh.player1_id, user.id], owner, fresh.id, async () => {
      await requireChallengePlayer(base44, user.id, fresh);
      await requireChallengePlayer(base44, fresh.player1_id, fresh, true);
      if (!creatorAuthorized(fresh) || challengeExpired(fresh)) fail('creator_not_ready', 'Readiness expired. No funds have been reserved.');
      // This is a short recovery marker, never an onboarding/funding queue.
      const operating = await base44.asServiceRole.entities.Match.update(fresh.id, {
        challenge_operation_state: 'reserving', challenge_claimant_id: user.id,
        challenge_operation_started_at: nowIso(), challenge_recipient_consent_at: nowIso(),
      });
      let commitAuthorized = false;
      try {
        return await finishReservation(base44, operating, owner, async () => {
          // Recheck inside the existing GLOBAL financial lease: UI checks are not authorization.
          if (!await refreshContestLocks(fresh.id, [fresh.player1_id, user.id], owner)) fail('busy', 'Challenge ownership changed.');
          const latest = await base44.asServiceRole.entities.Match.get(fresh.id);
          if (latest.status !== 'searching' || latest.challenge_claimant_id !== user.id ||
              latest.challenge_operation_state !== 'reserving' || challengeExpired(latest) || !creatorAuthorized(latest))
            fail('unavailable', 'This challenge is no longer ready. No funds were reserved.');
          await requireChallengePlayer(base44, user.id, latest);
          await requireChallengePlayer(base44, latest.player1_id, latest, true);
          if (!(await getMatchLocationReadiness(base44, { ...latest, player2_id: user.id })).ready)
            fail('location_required', 'Readiness expired. Recheck location before accepting.', 403);
          commitAuthorized = true;
          return true;
        });
      } catch (error) {
        if (!commitAuthorized && !await batchFor(base44, reservationGroup(operating))) {
          await clearChallengeWalletBarriers([fresh.player1_id, user.id], fresh.id);
          await base44.asServiceRole.entities.Match.update(fresh.id, {
            challenge_operation_state: 'idle', challenge_claimant_id: '', challenge_operation_started_at: '',
          });
          throw error;
        }
        // A submitted journal write may have committed even if its response was
        // lost. NEVER report "nothing reserved", retry a different opponent,
        // or clear the spending barrier until durable recovery determines it.
        console.error(JSON.stringify({ event: 'challenge_reservation_recovery_required', match_id: fresh.id, error: String(error?.message || 'unknown').slice(0, 150) }));
        return { processing: true, message: 'Confirming the reservation result. Your challenge will resume automatically.' };
      }
    });
  });
}

async function releaseChallengeLocked(base44: any, match: any, owner: string, reason: string) {
  const recipientId = match.player2_id || match.challenge_claimant_id;
  const committed = await batchFor(base44, reservationGroup(match));
  if (!committed) {
    if (activeOperation(match)) return recoverReservation(base44, match, owner);
    const updated = await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'cancelled', result: 'cancelled', challenge_close_reason: reason,
      challenge_authorized_until: nowIso(), challenge_operation_state: 'idle',
    });
    await challengeEvent(base44, updated, 'closed', '', reason);
    return { match: updated };
  }
  // A started Game is never refunded by invitation cancellation or expiry.
  const games = await base44.asServiceRole.entities.Game.filter({ match_id: match.id }, 'created_date', 1);
  if (games[0]) fail('already_started', 'This match has started and cannot be cancelled.');
  if (!recipientId) throw new Error('missing_challenge_recipient');
  if (!await setChallengeWalletBarriers([match.player1_id, recipientId], owner, match.id)) fail('wallet_busy', 'Wallet recovery is in progress.');
  // First complete the committed reservation projection, even when an earlier
  // request stopped before participant/deposited flags were materialized.
  if (match.challenge_operation_state === 'reserving') {
    await finishReservation(base44, match, owner);
    if (!await setChallengeWalletBarriers([match.player1_id, recipientId], owner, match.id)) fail('wallet_busy', 'Wallet recovery is in progress.');
  }
  await base44.asServiceRole.entities.Match.update(match.id, {
    status: 'cancelling', challenge_operation_state: 'releasing', challenge_close_reason: reason,
  });
  await postLedgerLegs(base44, {
    groupId: refundGroup(match), matchId: match.id, actor: 'system', actorId: '',
    triggerEvent: 'challenge_release', externalRefType: 'match', externalRefId: match.id,
    legs: challengeReleaseLegs(match, recipientId), updateTransactions: false,
    beforePost: async () => {
      if (!await refreshContestLocks(match.id, [match.player1_id, recipientId], owner)) throw new Error('challenge_lease_lost');
      return true;
    },
    afterPost: async () => {
      await materializeChallengeTransactions(base44, match, recipientId, true);
      await base44.asServiceRole.entities.Match.update(match.id, { status: 'cancelled', result: 'cancelled',
        challenge_operation_state: 'releasing', challenge_close_reason: reason, challenge_release_group_id: refundGroup(match) });
    },
  });
  await clearChallengeWalletBarriers([match.player1_id, recipientId], match.id);
  const updated = await base44.asServiceRole.entities.Match.update(match.id, { challenge_operation_state: 'released' });
  await challengeEvent(base44, updated, 'released', '', reason);
  return { match: updated };
}

export async function cancelChallenge(base44: any, user: any, matchId: string) {
  return underMatchLock(base44, matchId, async (match, owner) => {
    if (!roleFor(match, user.id)) fail('forbidden', 'Only a participant can cancel this challenge.', 403);
    if (match.status === 'cancelled' && !activeOperation(match)) return { match, replay: true };
    if (match.start_operation_id || ['in_progress', 'settling', 'completed', 'disputed'].includes(match.status))
      fail('already_started', 'This match has entered its start transition and can no longer be cancelled manually.');
    const ids = [match.player1_id, match.player2_id || match.challenge_claimant_id].filter(Boolean);
    return underWalletLocks(ids, owner, match.id, () => releaseChallengeLocked(base44, match, owner, 'cancelled'));
  });
}

export async function readyChallenge(req: Request, base44: any, user: any, matchId: string, body: any) {
  return underMatchLock(base44, matchId, async (match) => {
    const role = roleFor(match, user.id);
    if (!role) fail('forbidden', 'You are not a player in this match.', 403);
    if (match.status === 'in_progress') return { match };
    if (activeOperation(match)) fail('recovery_pending', 'Confirming the reservation result. Please retry readiness shortly.');
    if (!['preparing', 'both_ready'].includes(match.status) || challengeStartExpired(match))
      fail('ready_expired', 'The start window has ended. Reserved entry amounts and fees will be released.');
    // Available Balance was already reserved; only nonfinancial eligibility is
    // checked here. Never attempt a second debit or require a second deposit.
    const current = await base44.asServiceRole.entities.User.get(user.id);
    if (!paidContestsEnabled() || !await hasVerifiedIdentity(base44, current) || current.withdrawal_hold)
      fail('account_restricted', 'Your account is not currently eligible to start this match.', 403);
    const deviceHash = await sha256Hex(req.headers.get('user-agent') || '');
    if (body.action === 'heartbeat') {
      // Renew only a visible, already-readied device. A background tab or
      // unrelated session cannot create or inherit start readiness.
      const old = Date.parse(match[`challenge_${role}_ready_at`] || '');
      if (body.visible !== true || match[`challenge_${role}_device_hash`] !== deviceHash ||
          !Number.isFinite(old) || old > Date.now() || Date.now() - old >= 30000) return { match, needsReady: true };
    } else {
      const location = await verifyMatchLocation(req, match, body);
      if (location.status !== 'approved') fail('location_required', location.reason || 'Recheck your location before play.', 403);
    }
    const updated = await base44.asServiceRole.entities.Match.update(match.id, {
      [`challenge_${role}_ready_at`]: nowIso(), [`challenge_${role}_device_hash`]: deviceHash,
    });
    return { match: updated, ready: true };
  });
}

// Reuse getOrCreateGame and the existing Game/settlement implementation. This
// is only the new invitation's start gate; it is not a second chess engine.
export async function finalizeChallengeStart(base44: any, user: any, matchId: string) {
  return underMatchLock(base44, matchId, async (match, owner) => {
    if (!roleFor(match, user.id)) fail('forbidden', 'You are not a player in this match.', 403);
    if (['in_progress', 'completed', 'cancelled', 'settling'].includes(match.status)) return { match };
    if (activeOperation(match) || !['preparing', 'both_ready'].includes(match.status)) return { match };
    // A lost final response must resume an already-created game immediately,
    // without another ready countdown requirement or any clock reset.
    if (match.start_operation_id) {
      const games = await base44.asServiceRole.entities.Game.filter({ match_id: match.id }, 'created_date', 1);
      if (games[0] && Number(games[0].launch_epoch) === 2 && games[0].player1_id === match.player1_id && games[0].player2_id === match.player2_id) {
        const updated = await base44.asServiceRole.entities.Match.update(match.id, { status: 'in_progress', game_id: games[0].id });
        return { match: updated, recovered: true };
      }
    }
    if (challengeStartExpired(match)) fail('ready_expired', 'The start window expired. This match will close and release both reservations.');
    if (!bothChallengePlayersReady(match)) return { match, waitingForReady: true };
    if (!match.player1_certified || !match.player2_certified || !match.player1_deposited || !match.player2_deposited)
      fail('reservation_incomplete', 'Both reservations must be complete before play.');
    for (const id of [match.player1_id, match.player2_id]) {
      const current = await base44.asServiceRole.entities.User.get(id);
      if (!paidContestsEnabled() || !await hasVerifiedIdentity(base44, current) || current.withdrawal_hold)
        fail('account_restricted', 'A participant is not currently eligible to start.', 403);
    }
    const locationReadiness = await getMatchLocationReadiness(base44, match);
    if (!locationReadiness.ready)
      fail('location_required', 'Both players need current location checks before play.', 403, { requiredUserIds: locationReadiness.requiredUserIds });
    if (!await batchFor(base44, reservationGroup(match))) throw new Error('missing_challenge_reservation');
    const starting = await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'both_ready', start_operation_id: match.start_operation_id || crypto.randomUUID(),
    });
    if (!await refreshContestLocks(match.id, [], owner)) throw new Error('challenge_lease_lost');
    const response = await base44.functions.invoke('getOrCreateGame', { matchId, challengeStartOwner: owner });
    const game = response.data?.game;
    if (!game?.id) fail('start_retry', 'The match is starting. Please try again.');
    const updated = await base44.asServiceRole.entities.Match.update(match.id, { status: 'in_progress', game_id: game.id });
    await recordIntegrationEvent(base44, { eventType: 'contest.started', aggregateType: 'match', aggregateId: match.id,
      correlationId: match.id, idempotencyKey: `contest.started:${match.id}`, actorType: 'system', userId: match.player1_id,
      counterpartyUserId: match.player2_id, matchId: match.id, gameId: game.id, status: 'in_progress', result: 'in_progress',
      eventData: { challenge_version: CHALLENGE_VERSION, entry_amount: starting.wager_amount, platform_service_fee: starting.platform_service_fee } });
    return { match: updated };
  });
}

// Extends the existing PreparationTimeout sweep. No new queue, scheduler,
// polling service, parallel settlement system, or automatic ACH crediting.
export async function recoverChallenge(base44: any, matchId: string) {
  return underMatchLock(base44, matchId, async (match, owner) => {
    if (['in_progress', 'settling', 'completed', 'disputed'].includes(match.status)) return { skipped: true };
    if (match.status === 'cancelled' && match.challenge_operation_state === 'released') {
      await clearChallengeWalletBarriers([match.player1_id, match.player2_id].filter(Boolean), match.id);
      return { skipped: true };
    }
    const ids = [match.player1_id, match.player2_id || match.challenge_claimant_id].filter(Boolean);
    return underWalletLocks(ids, owner, match.id, async () => {
      if (match.challenge_operation_state === 'releasing') return releaseChallengeLocked(base44, match, owner, match.challenge_close_reason || 'timeout');
      if (match.challenge_operation_state === 'reserving') return recoverReservation(base44, match, owner);
      if (match.status === 'searching' && challengeExpired(match)) return releaseChallengeLocked(base44, match, owner, 'expired');
      if (['preparing', 'both_ready'].includes(match.status) && challengeStartExpired(match)) {
        const games = await base44.asServiceRole.entities.Game.filter({ match_id: match.id }, 'created_date', 1);
        if (games[0] && match.start_operation_id) {
          const updated = await base44.asServiceRole.entities.Match.update(match.id, { status: 'in_progress', game_id: games[0].id });
          return { match: updated, recovered: true };
        }
        return releaseChallengeLocked(base44, match, owner, 'timeout');
      }
      // Completed projections may have survived a lost barrier-clear response.
      if (match.challenge_operation_state === 'committed') await clearChallengeWalletBarriers(ids, match.id);
      return { skipped: true };
    });
  });
}

export async function pingChallengeCreator(base44: any, user: any, match: any) {
  if (match.player1_id === user.id || match.status !== 'searching' || challengeExpired(match) || activeOperation(match))
    fail('unavailable', 'This challenge is not open.');
  const readiness = await inspectChallengePlayer(base44, user.id, match);
  if (!readiness.ready) fail(readiness.code || 'not_ready', readiness.reason || 'Complete setup first.', 403);
  if (!await takeChallengeRateLimit(`ping:${match.player1_id}`, 1, 300) ||
      !await takeChallengeRateLimit(`ping-sender:${user.id}`, 10, 86400)) fail('rate_limited', 'The creator was recently notified. Please give them time to respond.', 429);
  const creator = await base44.asServiceRole.entities.User.get(match.player1_id);
  if (!creator?.email || match.notify_on_accept === false) return { notified: false };
  const url = `https://worldchessbet.com${challengePath(match.invite_code)}`;
  await base44.asServiceRole.integrations.Core.SendEmail({
    to: creator.email, from_name: 'ChessBet', subject: 'Someone is ready for your ChessBet challenge',
    body: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Your $${Number(match.wager_amount).toFixed(2)} challenge has interest</h2><p>A funded player wants to play. Your challenge is still open: no opponent has claimed it and no funds are reserved.</p><p><a href="${url}">Open your challenge and confirm readiness</a></p><p>The first eligible, funded player to accept while you are ready gets the match.</p></div>`,
  });
  await challengeEvent(base44, match, 'creator_notified', user.id, 'nonexclusive_interest', String(Math.floor(Date.now() / 300000)));
  return { notified: true };
}
