import { runContestEligibility } from '../../shared/runContestEligibility.ts';
import { paidContestsEnabled } from '../../shared/seamlessFundingConfig.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { acquireMatchLock, releaseMatchLock, acquireUserWalletLock, releaseUserWalletLock,
  refreshContestLocks } from '../../shared/seamlessAtomicStore.ts';
import { findConflictingMatch } from '../../shared/challengeAccess.ts';
import { hasVerifiedIdentity } from '../../shared/identityEligibility.js';

// Public marketplace only. Its existing explicit per-player preparation and
// funding screens remain unchanged. Shared wallet/match leases prevent a
// public acceptance racing either participant into a challenge-link game.
Deno.serve(async (req) => {
  const owner = crypto.randomUUID();
  let matchLockId = '';
  const walletLocks: string[] = [];
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!paidContestsEnabled()) return Response.json({ error: 'Paid contests are temporarily unavailable.', action: 'paid_contests_disabled' }, { status: 409 });
    const { matchId } = await req.json();
    if (typeof matchId !== 'string' || !matchId || matchId.length > 128) return Response.json({ error: 'matchId is required' }, { status: 400 });
    let match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match || Number(match.launch_epoch) !== 2) return Response.json({ error: 'Match not available' }, { status: 404 });
    // Knowing a private Match ID or an old invitation token never bypasses
    // the new dual-reservation consent/readiness/financial action.
    if (match.is_private || Number(match.challenge_version) === 1)
      return Response.json({ error: 'Open the shared challenge link to continue.', action: 'challenge_link_required' }, { status: 409 });
    if (match.player1_id === user.id) return Response.json({ error: 'You cannot accept your own match' }, { status: 400 });
    if (match.status !== 'searching') return Response.json({ error: 'This match is no longer available' }, { status: 409 });

    const eligibility = await (await runContestEligibility(req, {
      entryAmount: Number(match.wager_amount) + Number(match.platform_service_fee || 0),
      triggerEvent: 'accept_match', relatedEntityType: 'match', relatedEntityId: match.id,
    })).json();
    if (eligibility.error || eligibility.eligible !== true)
      return Response.json({ error: eligibility.reason || eligibility.error || 'Complete wallet setup before joining.' }, { status: 403 });

    if (!await acquireMatchLock(match.id, owner)) return Response.json({ error: 'This match is being updated. Please try again.' }, { status: 409 });
    matchLockId = match.id;
    for (const id of [match.player1_id, user.id].sort()) {
      if (!await acquireUserWalletLock(id, owner)) return Response.json({ error: 'A wallet is updating. Please try again.' }, { status: 409 });
      walletLocks.push(id);
    }
    match = await base44.asServiceRole.entities.Match.get(matchId);
    if (match.status !== 'searching' || match.player2_id || match.is_private)
      return Response.json({ error: 'Another player already accepted this match.' }, { status: 409 });
    const total = Math.round((Number(match.wager_amount) + Number(match.platform_service_fee)) * 100);
    if (!Number.isFinite(total) || total <= 0) return Response.json({ error: 'This match is missing valid financial terms.' }, { status: 409 });
    for (const id of [match.player1_id, user.id]) {
      if (await findConflictingMatch(base44, id, match.id))
        return Response.json({ error: id === user.id ? 'Finish your current match before accepting another.' : 'This opponent is currently in another match.' }, { status: 409 });
      const current = await base44.asServiceRole.entities.User.get(id);
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: id });
      if (!await hasVerifiedIdentity(base44, current) || current.withdrawal_hold ||
          !Number.isFinite(Number(wallets[0]?.available_balance)) || Math.round(Number(wallets[0]?.available_balance || 0) * 100) < total)
        return Response.json({ error: id === user.id ? 'Available funds must cover the entry amount and service fee.' : 'This opponent is not currently ready to play.' }, { status: 403 });
    }
    if (!await refreshContestLocks(match.id, walletLocks, owner)) return Response.json({ error: 'Acceptance timed out. Please try again.' }, { status: 409 });
    const updated = await base44.asServiceRole.entities.Match.update(match.id, {
      player2_id: user.id, acceptance_operation_id: owner,
      status: 'preparing', preparation_started_at: new Date().toISOString(),
    });
    await recordIntegrationEvent(base44, { eventType: 'contest.accepted', aggregateType: 'match', aggregateId: match.id,
      correlationId: match.id, idempotencyKey: `contest.accepted:${match.id}`, actorType: 'user', actorId: user.id,
      userId: user.id, counterpartyUserId: match.player1_id, matchId: match.id, status: updated.status,
      amount: match.wager_amount, result: 'opponent_reserved',
      eventData: { player1_id: match.player1_id, player2_id: user.id, preparation_started_at: updated.preparation_started_at, is_private: false } });
    return Response.json({ match: updated });
  } catch (error) {
    console.error(JSON.stringify({ event: 'public_accept_failed', error: String(error?.message || 'unknown').slice(0, 160) }));
    return Response.json({ error: 'Unable to accept this match. Please try again.' }, { status: 503 });
  } finally {
    for (const id of walletLocks.reverse()) await releaseUserWalletLock(id, owner).catch(() => {});
    if (matchLockId) await releaseMatchLock(matchLockId, owner).catch(() => {});
  }
});
