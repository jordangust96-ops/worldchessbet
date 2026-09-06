import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { readMyRating } from '../../shared/myRatingRead.js';

const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization, Cookie' };
Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers });
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.id) return Response.json({ error: 'authentication_required' }, { status: 401, headers });
    const body = await req.json().catch(() => null);
    // Identity always comes from auth.me(), never from a supplied profile ID.
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some((key) => !['time_control', 'before_game', 'generation'].includes(key))) {
      return Response.json({ error: 'invalid_request' }, { status: 400, headers });
    }
    const result = await readMyRating(base44.asServiceRole.entities, user.id, body);
    return Response.json(result, { headers });
  } catch (error) {
    const invalid = error instanceof Error && error.message === 'invalid_request';
    return Response.json({ error: invalid ? 'invalid_request' : 'rating_unavailable' },
      { status: invalid ? 400 : 503, headers });
  }
});
