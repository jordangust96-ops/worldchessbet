import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { processSignupConfirmation } from '../../shared/signupConfirmation.js';

Deno.serve(async (req) => {
  const headers = { 'Cache-Control':'no-store' };
  if (req.method !== 'POST') return Response.json({ error:'method_not_allowed' }, { status:405, headers });
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const store = {
      createSession: data => base44.asServiceRole.entities.MfaSession.create(data),
      revokeSessions: userId => base44.asServiceRole.entities.MfaSession.updateMany(
        { user_id:userId, revoked:false }, { $set:{ revoked:true } }),
      audit: async (userId, email, event, detail) => {
        try { await base44.asServiceRole.entities.MfaAuditLog.create({ user_id:userId, email, event, detail }); } catch {}
      },
    };
    const result = await processSignupConfirmation({
      email:body.email, otpCode:body.otpCode, store,
      userAgent:req.headers.get('user-agent') || '',
      verifyEmail: async (email, otpCode) => {
        const verified = await base44.auth.verifyOtp({ email, otpCode });
        if (typeof verified?.access_token !== 'string' || !verified.access_token) throw new Error('Missing verified login');
        base44.auth.setToken(verified.access_token, false);
        const user = await base44.auth.me();
        return { access_token:verified.access_token, user };
      },
    });
    return Response.json(result.body, { status:result.status, headers });
  } catch {
    return Response.json({ error:'confirmation_unavailable', message:'Email confirmation is temporarily unavailable. Please try again.' }, { status:503, headers });
  }
});
