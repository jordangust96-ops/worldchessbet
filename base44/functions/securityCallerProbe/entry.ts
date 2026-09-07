import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Temporary, read-only verification of Base44's authenticated workflow context.
// Never returns identity, tokens, request headers, or application data.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user = null;
  try { user = await base44.auth.me(); } catch {}
  return Response.json({ authenticated: !!user, admin: user?.role === 'admin' });
});
