import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

// Joining a match (public or private) only reserves the opponent slot and
// starts the shared Preparing Match phase — it never moves any funds and
// never initializes gameplay. The match immediately becomes unavailable to
// everyone else. Both players must then independently certify Fair Play and
// reserve their Entry Amount (certifyFairPlay / lockWager) before the match
// can ever go live — identical actions for host and joiner alike.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { matchId, inviteCode } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    let match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    if (match.status !== 'searching') {
      return Response.json({ error: 'This match is no longer available' }, { status: 400 });
    }
    if (match.acceptance_operation_id) {
      return Response.json({ error: 'acceptance_in_progress' }, { status: 409 });
    }
    if (match.player1_id === user.id) {
      return Response.json({ error: 'You cannot accept your own match' }, { status: 400 });
    }
    if (match.is_private && (typeof inviteCode !== 'string' || inviteCode !== match.invite_code)) {
      return Response.json({ error: 'A valid private invitation is required' }, { status: 403 });
    }

    // Eligibility — the single shared pipeline (identity, jurisdiction,
    // participation restrictions, available balance) also used by Host
    // Match. No funds are held here.
    const eligibilityRes = await base44.functions.invoke('runContestEligibility', {
      entryAmount: match.wager_amount,
      relatedEntityType: 'match',
      relatedEntityId: match.id,
    });
    if (eligibilityRes.data?.error || !eligibilityRes.data?.eligible) {
      return Response.json({ error: eligibilityRes.data?.reason || eligibilityRes.data?.error || 'You are not eligible to join this contest' }, { status: 403 });
    }

    const acceptanceOperationId = crypto.randomUUID();
    await base44.asServiceRole.entities.Match.update(match.id, {
      acceptance_operation_id: acceptanceOperationId,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    match = await base44.asServiceRole.entities.Match.get(match.id);
    if (match.acceptance_operation_id !== acceptanceOperationId || match.status !== 'searching') {
      return Response.json({ error: 'match_acceptance_claim_lost' }, { status: 409 });
    }

    // The host's own jurisdiction is never trusted from a cached field here —
    // that previously relied on host.jurisdiction_status, which could go
    // stale (e.g. it would keep rejecting a Michigan host who was verified
    // before Michigan was added to the approved list, even though they are
    // actually approved under the current rules). Jurisdiction is instead
    // authoritatively re-verified fresh for the host at the moment they
    // reserve their entry amount in lockWager, so no funds ever move for an
    // unapproved host — this join step itself moves no money.

    // Reserve the opponent slot atomically — only succeeds while the match is
    // still 'searching', so two simultaneous joiners can never both win the
    // slot. Moves both players into the shared Preparing Match phase.
    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      player2_id: user.id,
      acceptance_operation_id: acceptanceOperationId,
      status: 'preparing',
      preparation_started_at: new Date().toISOString(),
    });

    await recordIntegrationEvent(base44, {
      eventType: 'contest.accepted',
      aggregateType: 'match',
      aggregateId: match.id,
      correlationId: match.id,
      idempotencyKey: `contest.accepted:${match.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      counterpartyUserId: match.player1_id,
      matchId: match.id,
      status: updatedMatch.status,
      amount: match.wager_amount,
      result: 'opponent_reserved',
      eventData: {
        player1_id: match.player1_id,
        player2_id: user.id,
        preparation_started_at: updatedMatch.preparation_started_at,
        is_private: !!match.is_private,
      },
    });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});