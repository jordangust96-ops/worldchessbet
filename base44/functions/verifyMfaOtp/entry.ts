import { processVerify } from '../../shared/mfaVerify.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const userAgent = req.headers.get('user-agent') || '';

    const store = {
      getActiveCodes: (userId, limit) =>
        base44.asServiceRole.entities.MfaCode.filter({ user_id: userId, status: 'active' }, '-created_date', limit),
      getCode: (userId, codeId) =>
        base44.asServiceRole.entities.MfaCode.get(codeId),
      updateCode: (userId, codeId, filter, update) =>
        base44.asServiceRole.entities.MfaCode.updateMany({ user_id: userId, id: codeId, ...filter }, update),
      createSession: (data) =>
        base44.asServiceRole.entities.MfaSession.create(data),
      revokeSessions: (userId) =>
        base44.asServiceRole.entities.MfaSession.updateMany({ user_id: userId, revoked: false }, { $set: { revoked: true } }),
      audit: async (userId, email, event, detail) => {
        try {
          await base44.asServiceRole.entities.MfaAuditLog.create({ user_id: userId, email, event, detail });
        } catch { /* audit failure must not fail the operation */ }
      },
    };

    const result = await processVerify({ code: body.code, user, store, userAgent });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error(JSON.stringify({ event: 'verify_mfa_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error', message: 'Verification is temporarily unavailable.' }, { status: 500 });
  }
});