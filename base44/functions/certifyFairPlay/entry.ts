import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Records a player's independent Fair Play certification during the shared
// Preparing Match phase. Required before that player's Entry Amount can be
// reserved (see lockWager). Also duplicated here (not imported — backend
// functions deploy independently): once both players have certified AND
// reserved funds, this is the trigger that creates/loads the Game and takes
// the match live.

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

    if (match.status !== 'preparing' && match.status !== 'both_ready') {
      return Response.json({ error: 'This match is not awaiting readiness confirmation' }, { status: 400 });
    }

    const alreadyCertified = isP1 ? match.player1_certified : match.player2_certified;
    if (alreadyCertified) {
      return Response.json({ match });
    }

    const now = new Date().toISOString();
    const certUpdates = isP1
      ? { player1_certified: true, player1_certified_at: now }
      : { player2_certified: true, player2_certified_at: now };
    let updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, certUpdates);

    // Only when BOTH players have certified Fair Play AND successfully
    // reserved funds does the match go live — never earlier.
    const bothCertified = updatedMatch.player1_certified && updatedMatch.player2_certified;
    const bothDeposited = updatedMatch.player1_deposited && updatedMatch.player2_deposited;
    if (bothCertified && bothDeposited) {
      await base44.asServiceRole.entities.Match.update(match.id, { status: 'both_ready' });
      await base44.functions.invoke('getOrCreateGame', { matchId: match.id });
      updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, { status: 'in_progress' });
    }

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});