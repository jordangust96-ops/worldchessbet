import { buildMfaEmail } from '../../shared/mfaEmail.js';
import {
  sha256Hex,
  generateOtp,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_REQUESTS_PER_HOUR,
  MAX_ATTEMPTS,
} from '../../shared/mfaCore.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch { /* empty body is fine */ }
    const mode = body.mode === 'resend' ? 'resend' : 'resume';

    const now = new Date();
    const recentCodes = await base44.asServiceRole.entities.MfaCode.filter(
      { user_id: user.id }, '-created_date', 10
    );

    // --- RESUME MODE: return existing active challenge without replacing it ---
    if (mode === 'resume') {
      const activeCode = recentCodes.find(
        (c) => c.status === 'active' && new Date(c.expires_at) > now
      );
      if (activeCode) {
        const elapsed = now.getTime() - new Date(activeCode.created_date).getTime();
        const cooldownRemaining = Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000));
        return Response.json({
          success: true,
          resumed: true,
          expires_at: activeCode.expires_at,
          cooldown_seconds: cooldownRemaining,
          attempts_remaining: MAX_ATTEMPTS - (activeCode.attempts || 0),
        });
      }
      // No active code — fall through to generate a new one.
    }

    // --- RESEND MODE: enforce cooldown ---
    if (mode === 'resend') {
      const lastCode = recentCodes[0];
      if (lastCode) {
        const elapsed = now.getTime() - new Date(lastCode.created_date).getTime();
        if (elapsed < RESEND_COOLDOWN_MS) {
          const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
          const activeCode = recentCodes.find(
            (c) => c.status === 'active' && new Date(c.expires_at) > now
          );
          return Response.json({
            error: 'cooldown',
            retry_after_seconds: retryAfter,
            message: `Please wait ${retryAfter}s before requesting another code.`,
            expires_at: activeCode?.expires_at || null,
            attempts_remaining: activeCode ? MAX_ATTEMPTS - (activeCode.attempts || 0) : 0,
          }, { status: 429 });
        }
      }
    }

    // --- HOURLY RATE LIMIT ---
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const requestsLastHour = recentCodes.filter((c) => new Date(c.created_date) > oneHourAgo).length;
    if (requestsLastHour >= MAX_REQUESTS_PER_HOUR) {
      const oldestInWindow = recentCodes
        .filter((c) => new Date(c.created_date) > oneHourAgo)
        .sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime())[0];
      const retryAfter = oldestInWindow
        ? Math.ceil((new Date(oldestInWindow.created_date).getTime() + 60 * 60 * 1000 - now.getTime()) / 1000)
        : 3600;
      try {
        await base44.asServiceRole.entities.MfaAuditLog.create({
          user_id: user.id, email: user.email, event: 'rate_limited',
          detail: 'Too many OTP requests within an hour',
        });
      } catch { /* audit failure must not fail the operation */ }
      return Response.json({
        error: 'rate_limited',
        retry_after_seconds: retryAfter,
        message: 'Too many verification code requests. Please try again later.',
      }, { status: 429 });
    }

    // --- GENERATE NEW CODE ---
    const code = generateOtp();
    const salt = crypto.randomUUID();
    const codeHash = await sha256Hex(salt + code);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();

    const newCode = await base44.asServiceRole.entities.MfaCode.create({
      user_id: user.id,
      email: user.email,
      code_hash: codeHash,
      salt,
      expires_at: expiresAt,
      attempts: 0,
      status: 'active',
    });

    // --- CONCURRENT REQUEST RACE PREVENTION ---
    // Read all active codes. The newest one (by created_date) wins; all others
    // are duplicates from concurrent requests and are invalidated without sending.
    const activeCodes = await base44.asServiceRole.entities.MfaCode.filter(
      { user_id: user.id, status: 'active' }, '-created_date', 10
    );

    if (activeCodes.length > 0 && activeCodes[0].id !== newCode.id) {
      // My code is NOT the newest — another concurrent request won.
      await base44.asServiceRole.entities.MfaCode.updateMany(
        { id: newCode.id, status: 'active' },
        { $set: { status: 'invalidated' } }
      );
      const winner = activeCodes[0];
      return Response.json({
        success: true,
        resumed: true,
        expires_at: winner.expires_at,
        cooldown_seconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
        attempts_remaining: MAX_ATTEMPTS - (winner.attempts || 0),
      });
    }

    // --- SEND EMAIL ---
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: user.email,
        subject: 'Your ChessBet verification code',
        body: buildMfaEmail(code, OTP_TTL_MS / 60000),
        from_name: 'ChessBet',
      });
    } catch {
      // Email delivery failed — invalidate the new code, keep old codes intact.
      await base44.asServiceRole.entities.MfaCode.updateMany(
        { id: newCode.id, status: 'active' },
        { $set: { status: 'invalidated' } }
      );
      try {
        await base44.asServiceRole.entities.MfaAuditLog.create({
          user_id: user.id, email: user.email, event: 'otp_failed',
          detail: 'Email delivery failed during OTP request',
        });
      } catch { /* audit failure must not mask the real error */ }
      return Response.json({
        error: 'delivery_failed',
        message: 'We couldn\'t send your verification code. Please try again in a moment.',
      }, { status: 502 });
    }

    // --- EMAIL SUCCEEDED: atomically invalidate all other active codes ---
    // Use per-document CAS (updateMany with status:'active' filter) rather
    // than $ne on the id field, which may not be supported in all SDK filters.
    const allActiveAfter = await base44.asServiceRole.entities.MfaCode.filter(
      { user_id: user.id, status: 'active' }, '-created_date', 20
    );
    await Promise.all(
      allActiveAfter
        .filter((c) => c.id !== newCode.id)
        .map((c) =>
          base44.asServiceRole.entities.MfaCode.updateMany(
            { id: c.id, status: 'active' },
            { $set: { status: 'invalidated' } }
          )
        )
    );

    // --- AUDIT (failure must not fail the operation) ---
    try {
      await base44.asServiceRole.entities.MfaAuditLog.create({
        user_id: user.id, email: user.email, event: 'otp_requested',
        detail: 'OTP generated and sent to email',
      });
    } catch { /* audit failure must not fail the operation */ }

    return Response.json({
      success: true,
      expires_at: expiresAt,
      cooldown_seconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
      attempts_remaining: MAX_ATTEMPTS,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});