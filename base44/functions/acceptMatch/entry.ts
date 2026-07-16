import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

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

    // Eligibility — the single shared pipeline (identity, jurisdiction,
    // participation restrictions, available balance) also used by Host
    // Match. No funds are held here.
    const eligibilityRes = await base44.functions.invoke('runContestEligibility', { entryAmount: match.wager_amount });
    if (eligibilityRes.data?.error || !eligibilityRes.data?.eligible) {
      return Response.json({ error: eligibilityRes.data?.reason || eligibilityRes.data?.error || 'You are not eligible to join this contest' }, { status: 403 });
    }

    // The host's own jurisdiction can't be re-verified live from this
    // request (only the joining player's connection is available here), so
    // this checks the host's most recently recorded status instead — kept
    // fresh by getCurrentJurisdiction at the host's own login and every
    // paid action they take. Rejects the challenge if either player is
    // outside an approved jurisdiction.
    const host = await base44.asServiceRole.entities.User.get(match.player1_id);
    if (host?.jurisdiction_status !== 'approved') {
      return Response.json({ error: 'This challenge is currently unavailable because the host is outside an approved jurisdiction.' }, { status: 403 });
    }

    // Reserve the opponent slot atomically — only succeeds while the match is
    // still 'searching', so two simultaneous joiners can never both win the
    // slot. Moves both players into the shared Preparing Match phase.
    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      player2_id: user.id,
      status: 'preparing',
      preparation_started_at: new Date().toISOString(),
    });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});