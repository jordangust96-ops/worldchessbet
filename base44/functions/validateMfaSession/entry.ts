import { processValidateSession } from '../../shared/mfaVerify.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ valid: false, error: 'unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const userAgent = req.headers.get('user-agent') || '';

    const store = {
      getSessions: (userId, tokenHash) =>
        base44.asServiceRole.entities.MfaSession.filter({
          user_id: userId,
          token_hash: tokenHash,
          revoked: false,
        }, '-created_date', 1),
      revokeSession: (userId, sessionId) =>
        base44.asServiceRole.entities.MfaSession.update(sessionId, { revoked: true }),
      audit: async (userId, email, event, detail) => {
        try {
          await base44.asServiceRole.entities.MfaAuditLog.create({ user_id: userId, email, event, detail });
        } catch { /* audit failure must not fail the validation */ }
      },
    };

    const result = await processValidateSession({
      sessionToken: body.sessionToken,
      user,
      store,
      userAgent,
    });

    if (result.valid) {
      const resBody = { valid: true };
      if (result.bypass) resBody.bypass = true;
      if (result.expires_at) resBody.expires_at = result.expires_at;
      return Response.json(resBody, { status: 200 });
    }
    const resBody = { valid: false };
    if (result.expired) resBody.expired = true;
    return Response.json(resBody, { status: 401 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'validate_mfa_session_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ valid: false, error: 'internal_error' }, { status: 500 });
  }
});