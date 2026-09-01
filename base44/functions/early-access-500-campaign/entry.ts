import { createClientFromRequest } from 'npm:@base44/sdk';
import { requireAdminMfa } from '../../shared/mfa.ts';

// Retired one-time campaign endpoint retained only for stale-client safety.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const caller = await base44.auth.me();
  const body = await req.json().catch(() => ({}));
  const mfaError = await requireAdminMfa(base44, caller, body?.mfaSessionToken, req.headers.get('user-agent') || '');
  if (mfaError) return mfaError;
  return Response.json({ error: 'This retired campaign is no longer available.' }, { status: 410 });
});
