import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Accepting a match means setting player2_id to the accepting user — but Match
// RLS only allows updates from the existing player1/player2/admin, so a direct
// client-side update is blocked before player2_id is set. This runs
// server-side with the service role to perform that transition safely.
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

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      player2_id: user.id,
      status: 'matched',
    });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});