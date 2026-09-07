import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Temporary, read-only verification of Base44's authenticated workflow context.
// Never returns identity, tokens, request headers, or application data.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user = null;
  try { user = await base44.auth.me(); } catch {}
  if (user?.role !== 'admin') return Response.json({ error: 'admin_context_missing' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.internal_probe) {
    const internal = await base44.asServiceRole.functions.invoke('securityCallerProbe', { internal_probe: true });
    if (internal.data?.admin !== true) return Response.json({ error: 'internal_context_missing' }, { status: 403 });
  }
  return Response.json({ authenticated: true, admin: true });
});
