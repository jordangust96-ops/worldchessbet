import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

// New matches use manageChallenge.create. Existing posted matches keep their
// original acceptance and settlement handlers; stale creation clients must refresh.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error:'Unauthorized' }, { status:401 });
  return Response.json({ error:'Use Create Challenge and turn on Show in Find an Opponent to post publicly.',
    action:'unified_challenge_required', path:'/play' }, { status:409 });
});
