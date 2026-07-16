import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Joining a match (public or private) only reserves the opponent slot here —
// it never moves any funds. The host's Entry Hold was already placed at
// creation (player1_deposited is always true by this point), but the joiner
// must still explicitly re-attest Fair Play and click "Fund" on the Match
// Accepted screen (handled by the lockWager function) before their own funds
// are held and the match can go live. This guarantees both players have
// accepted terms AND deposited before the game ever becomes playable.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    if (match.status !== 'searching') {
      return Response.json({ error: 'This match is no longer available' }, { status: 400 });
    }
    if (match.player1_id === user.id) {
      return Response.json({ error: 'You cannot accept your own match' }, { status: 400 });
    }

    // Eligibility — the single shared pipeline (identity, geolocation,
    // participation restrictions, available balance) also used by Host Match.
    // No Match state change happens unless this passes. Funds are NOT held
    // here — that only happens once the joiner explicitly clicks "Fund" on
    // the Match Accepted screen (lockWager).
    const eligibilityRes = await base44.functions.invoke('runContestEligibility', { entryAmount: match.wager_amount });
    if (eligibilityRes.data?.error || !eligibilityRes.data?.eligible) {
      return Response.json({ error: eligibilityRes.data?.reason || eligibilityRes.data?.error || 'You are not eligible to join this contest' }, { status: 403 });
    }

    // Reserve the opponent slot — the match now waits for the joiner to
    // deposit (via lockWager) before it can go to in_progress.
    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      player2_id: user.id,
      status: 'matched',
    });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});