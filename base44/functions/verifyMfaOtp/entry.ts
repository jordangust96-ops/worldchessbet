import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const MAX_ATTEMPTS = 5;
const MFA_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { code } = await req.json();
    if (!code || typeof code !== 'string') {
      return Response.json({ error: 'invalid', message: 'Invalid or expired code.' }, { status: 400 });
    }

    const codes = await base44.asServiceRole.entities.MfaCode.filter(
      { user_id: user.id, status: 'active' },
      '-created_date',
      1
    );
    const mfaCode = codes[0];

    if (!mfaCode) {
      await base44.asServiceRole.entities.MfaAuditLog.create({
        user_id: user.id,
        email: user.email,
        event: 'otp_failed',
        detail: 'No active code found for user',
      });
      return Response.json({ error: 'invalid', message: 'Invalid or expired code.' }, { status: 400 });
    }

    const now = new Date();
    if (now > new Date(mfaCode.expires_at)) {
      await base44.asServiceRole.entities.MfaCode.update(mfaCode.id, { status: 'expired' });
      await base44.asServiceRole.entities.MfaAuditLog.create({
        user_id: user.id,
        email: user.email,
        event: 'otp_expired',
        detail: 'Code expired before verification',
      });
      return Response.json({ error: 'expired', message: 'Your code has expired. Please request a new one.' }, { status: 400 });
    }

    if ((mfaCode.attempts || 0) >= MAX_ATTEMPTS) {
      await base44.asServiceRole.entities.MfaCode.update(mfaCode.id, { status: 'invalidated' });
      await base44.asServiceRole.entities.MfaAuditLog.create({
        user_id: user.id,
        email: user.email,
        event: 'otp_locked',
        detail: 'Max attempts exceeded before this request',
      });
      return Response.json(
        { error: 'too_many_attempts', message: 'Too many incorrect attempts. Please request a new code.' },
        { status: 400 }
      );
    }

    const candidateHash = await sha256Hex(mfaCode.salt + code.trim());
    if (candidateHash !== mfaCode.code_hash) {
      const attempts = (mfaCode.attempts || 0) + 1;
      const lockedOut = attempts >= MAX_ATTEMPTS;
      await base44.asServiceRole.entities.MfaCode.update(mfaCode.id, {
        attempts,
        ...(lockedOut ? { status: 'invalidated' } : {}),
      });
      await base44.asServiceRole.entities.MfaAuditLog.create({
        user_id: user.id,
        email: user.email,
        event: lockedOut ? 'otp_locked' : 'otp_failed',
        detail: `Incorrect code on attempt ${attempts}`,
      });
      return Response.json(
        {
          error: lockedOut ? 'too_many_attempts' : 'invalid',
          message: lockedOut
            ? 'Too many incorrect attempts. Please request a new code.'
            : 'Invalid code.',
        },
        { status: 400 }
      );
    }

    await base44.asServiceRole.entities.MfaCode.update(mfaCode.id, { status: 'verified' });

    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const sessionToken = btoa(String.fromCharCode(...tokenBytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const tokenHash = await sha256Hex(sessionToken);
    const deviceHash = await sha256Hex(req.headers.get('user-agent') || '');
    const expiresAt = new Date(now.getTime() + MFA_SESSION_TTL_MS).toISOString();

    const existingSessions = await base44.asServiceRole.entities.MfaSession.filter(
      { user_id: user.id, revoked: false },
      '-created_date',
      20
    );
    for (const session of existingSessions) {
      await base44.asServiceRole.entities.MfaSession.update(session.id, { revoked: true });
    }

    await base44.asServiceRole.entities.MfaSession.create({
      user_id: user.id,
      token_hash: tokenHash,
      device_hash: deviceHash,
      verified_at: now.toISOString(),
      expires_at: expiresAt,
      revoked: false,
    });

    await base44.asServiceRole.entities.MfaAuditLog.create({
      user_id: user.id,
      email: user.email,
      event: 'otp_verified',
      detail: 'MFA verification succeeded and a server session was issued',
    });

    return Response.json({
      success: true,
      verified_at: now.toISOString(),
      expires_at: expiresAt,
      session_token: sessionToken,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'verify_mfa_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error', message: 'Verification is temporarily unavailable.' }, { status: 500 });
  }
});