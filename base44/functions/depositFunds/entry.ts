import { createClientFromRequest } from 'npm:@base44/sdk';

// Retained for stale-client compatibility only. Supported deposits use the
// Seamless flow, which is separately protected by SEAMLESS_DEPOSITS_ENABLED.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ eligible: false, reason: 'Account funding is not available yet.', action: 'deposits_disabled' }, { status: 409 });
});
