import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const MAX_ATTEMPTS = 5;

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
    await base44.asServiceRole.entities.MfaAuditLog.create({
      user_id: user.id,
      email: user.email,
      event: 'otp_verified',
      detail: 'MFA verification succeeded',
    });

    return Response.json({ success: true, verified_at: now.toISOString() });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});