import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Manual promotion is intentionally disabled. Only an authenticated Seamless
// funding-source.verified webhook can make a player eligible.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({
    error: 'Manual account verification is retired; Seamless hosted Plaid is authoritative.',
  }, { status: 409 });
});
