import { processRequest } from '../../shared/mfaRequest.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch { /* empty body is fine */ }
    const mode = body.mode === 'resend' ? 'resend' : 'resume';

    const store = {
      getRecentCodes: (userId, limit) =>
        base44.asServiceRole.entities.MfaCode.filter({ user_id: userId }, '-created_date', limit),
      getActiveCodes: (userId, limit) =>
        base44.asServiceRole.entities.MfaCode.filter({ user_id: userId, status: 'active' }, '-created_date', limit),
      createCode: (data) =>
        base44.asServiceRole.entities.MfaCode.create(data),
      getCode: (userId, codeId) =>
        base44.asServiceRole.entities.MfaCode.get(codeId),
      updateCode: (userId, codeId, filter, update) =>
        base44.asServiceRole.entities.MfaCode.updateMany({ user_id: userId, id: codeId, ...filter }, update),
      audit: async (userId, email, event, detail) => {
        try {
          await base44.asServiceRole.entities.MfaAuditLog.create({ user_id: userId, email, event, detail });
        } catch { /* audit failure must not fail the operation */ }
      },
    };

    const emailSender = (to, subject, emailBody, fromName) =>
      base44.asServiceRole.integrations.Core.SendEmail({ to, subject, body: emailBody, from_name: fromName });

    const result = await processRequest({ mode, user, store, emailSender });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});