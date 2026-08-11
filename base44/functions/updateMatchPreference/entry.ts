import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { matchId, notifyOnAccept } = await req.json();
    if (typeof matchId !== 'string' || !matchId || typeof notifyOnAccept !== 'boolean') {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'match_not_found' }, { status: 404 });
    if (match.player1_id !== user.id) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    if (match.status !== 'searching') {
      return Response.json({ error: 'match_not_searching' }, { status: 409 });
    }

    const updated = await base44.asServiceRole.entities.Match.update(match.id, {
      notify_on_accept: notifyOnAccept,
    });
    return Response.json({ match: updated });
  } catch (error) {
    console.error(JSON.stringify({ event: 'update_match_preference_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
