import { createClientFromRequest } from 'npm:@base44/sdk';
import { requireAdminMfa } from '../../shared/mfa.ts';

// Socure is the authoritative identity-verification path. This retired manual
// verifier remains fail-closed for compatibility with any stale admin client.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    const body = await req.json().catch(() => ({}));
    const mfaError = await requireAdminMfa(base44, admin, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;
    return Response.json({ error: 'Manual identity verification is retired; Socure is authoritative.' }, { status: 409 });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to process verification request' }, { status: 500 });
  }
});
