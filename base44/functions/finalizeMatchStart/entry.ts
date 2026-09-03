import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

// Single, idempotent source of truth for finishing the "both_ready" -> game
// creation -> "in_progress" transition. Extracted out of certifyFairPlay and
// lockWager (which both call this instead of duplicating the transition) so
// that if the transition previously failed partway (e.g. getOrCreateGame
// threw, leaving the match stuck at "both_ready" with no further client
// action to retry it), any player can safely re-invoke this to repair the
// match. Safe to call any number of times — always converges on the same
// game and status.
//
// Claims the both_ready -> in_progress transition via start_operation_id,
// the same operation-id pattern acceptMatch/lockWager/cancelMatch use for
// their own transitions. This exists specifically so the preparation-timeout
// sweep (checkPreparationTimeout) can never refund-and-cancel a match in the
// narrow window where it has actually become fully certified/funded and is
// converging on going live — both sides check and respect each other's claim
// before committing money movement or a status change.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    let match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
    if (Number(match.launch_epoch) !== 2) return Response.json({ error: 'Match not available' }, { status: 410 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    // Nothing to do — already live, settled, or cancelled.
    if (['in_progress', 'completed', 'cancelled'].includes(match.status)) {
      return Response.json({ match });
    }

    // A cancellation (user-initiated, or the preparation-timeout sweep) is
    // already in flight or has already won this match. Never fight it —
    // refunds may already be posted. Return current state and let the
    // cancellation stand.
    if (match.cancellation_operation_id || match.status === 'cancelling') {
      return Response.json({ match });
    }

    const bothCertified = match.player1_certified && match.player2_certified;
    const bothDeposited = match.player1_deposited && match.player2_deposited;
    if (!bothCertified || !bothDeposited) {
      return Response.json({ match });
    }

    // Claim the both_ready -> in_progress transition so a concurrent
    // cancellation can never land in the gap between our read and our
    // write. Still idempotent/re-entrant: once a claim has been recorded
    // (status already 'both_ready', start_operation_id already set), a
    // repair re-invocation skips straight to resuming the work below.
    if (!match.start_operation_id) {
      const startOperationId = crypto.randomUUID();
      await base44.asServiceRole.entities.Match.update(match.id, {
        start_operation_id: startOperationId,
        status: 'both_ready',
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      match = await base44.asServiceRole.entities.Match.get(match.id);
      if (match.start_operation_id !== startOperationId) {
        // A concurrent finalizeMatchStart call (or a cancellation) won
        // instead — defer to it rather than forcing this one through.
        return Response.json({ match });
      }
    }

    // Re-confirm immediately before touching the Game: a cancellation could
    // have been claimed in the window between the claim above and here.
    if (match.cancellation_operation_id || match.status === 'cancelling' || match.status === 'cancelled') {
      return Response.json({ match });
    }

    const gameResponse = await base44.functions.invoke('getOrCreateGame', { matchId: match.id });
    const game = gameResponse.data?.game || null;

    // Final guard, taken fresh right before declaring the match live: if a
    // cancellation won while getOrCreateGame was in flight, do not overwrite
    // it — the refund already happened (or is happening) and must stand.
    match = await base44.asServiceRole.entities.Match.get(match.id);
    if (
      match.cancellation_operation_id ||
      ['cancelling', 'cancelled', 'in_progress', 'completed'].includes(match.status)
    ) {
      return Response.json({ match });
    }

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, { status: 'in_progress' });

    await recordIntegrationEvent(base44, {
      eventType: 'contest.started',
      aggregateType: 'match',
      aggregateId: match.id,
      correlationId: match.id,
      idempotencyKey: `contest.started:${match.id}`,
      actorType: 'system',
      userId: match.player1_id,
      counterpartyUserId: match.player2_id,
      matchId: match.id,
      gameId: game?.id || updatedMatch.game_id || '',
      status: updatedMatch.status,
      result: 'in_progress',
      eventData: {
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        game_id: game?.id || updatedMatch.game_id || '',
        time_control: match.time_control,
        entry_amount: match.wager_amount,
        platform_service_fee: match.platform_service_fee,
      },
    });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});