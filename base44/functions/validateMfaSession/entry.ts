import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ valid: false, error: 'unauthorized' }, { status: 401 });

    const { sessionToken } = await req.json();
    if (typeof sessionToken !== 'string' || sessionToken.length < 32 || sessionToken.length > 256) {
      return Response.json({ valid: false }, { status: 401 });
    }

    const tokenHash = await sha256Hex(sessionToken);
    const sessions = await base44.asServiceRole.entities.MfaSession.filter({
      user_id: user.id,
      token_hash: tokenHash,
      revoked: false,
    }, '-created_date', 1);
    const session = sessions[0];
    if (!session) return Response.json({ valid: false }, { status: 401 });

    const now = new Date();
    if (now >= new Date(session.expires_at)) {
      await base44.asServiceRole.entities.MfaSession.update(session.id, { revoked: true });
      return Response.json({ valid: false, expired: true }, { status: 401 });
    }

    const deviceHash = await sha256Hex(req.headers.get('user-agent') || '');
    if (deviceHash !== session.device_hash) {
      await base44.asServiceRole.entities.MfaSession.update(session.id, { revoked: true });
      await base44.asServiceRole.entities.MfaAuditLog.create({
        user_id: user.id,
        email: user.email,
        event: 'session_rejected',
        detail: 'MFA session device binding mismatch',
      });
      return Response.json({ valid: false }, { status: 401 });
    }

    return Response.json({ valid: true, expires_at: session.expires_at });
  } catch (error) {
    console.error(JSON.stringify({ event: 'validate_mfa_session_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ valid: false, error: 'internal_error' }, { status: 500 });
  }
});
