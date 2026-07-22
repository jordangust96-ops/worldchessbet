import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Single, idempotent source of truth for finishing the "both_ready" -> game
// creation -> "in_progress" transition. Extracted out of certifyFairPlay and
// lockWager (which both call this instead of duplicating the transition) so
// that if the transition previously failed partway (e.g. getOrCreateGame
// threw, leaving the match stuck at "both_ready" with no further client
// action to retry it), any player can safely re-invoke this to repair the
// match. Safe to call any number of times — always converges on the same
// game and status.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    // Nothing to do — already live, settled, or cancelled.
    if (['in_progress', 'completed', 'cancelled'].includes(match.status)) {
      return Response.json({ match });
    }

    const bothCertified = match.player1_certified && match.player2_certified;
    const bothDeposited = match.player1_deposited && match.player2_deposited;
    if (!bothCertified || !bothDeposited) {
      return Response.json({ match });
    }

    if (match.status !== 'both_ready') {
      await base44.asServiceRole.entities.Match.update(match.id, { status: 'both_ready' });
    }
    await base44.functions.invoke('getOrCreateGame', { matchId: match.id });
    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, { status: 'in_progress' });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});