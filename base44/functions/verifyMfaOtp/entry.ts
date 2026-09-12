import {
  sha256Hex,
  MAX_ATTEMPTS,
  MFA_SESSION_TTL_MS,
  normalizeOtpCode,
} from '../../shared/mfaCore.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const code = normalizeOtpCode(body.code);
    if (!code) {
      return Response.json({ error: 'invalid', message: 'Please enter the 6-digit code.' }, { status: 400 });
    }

    const codes = await base44.asServiceRole.entities.MfaCode.filter(
      { user_id: user.id, status: 'active' }, '-created_date', 1
    );
    const mfaCode = codes[0];

    if (!mfaCode) {
      try {
        await base44.asServiceRole.entities.MfaAuditLog.create({
          user_id: user.id, email: user.email, event: 'otp_failed',
          detail: 'No active code found for user',
        });
      } catch { /* audit failure must not fail the operation */ }
      return Response.json({ error: 'invalid', message: 'Invalid or expired code. Please request a new one.' }, { status: 400 });
    }

    const now = new Date();
    if (now > new Date(mfaCode.expires_at)) {
      await base44.asServiceRole.entities.MfaCode.updateMany(
        { id: mfaCode.id, status: 'active' },
        { $set: { status: 'expired' } }
      );
      try {
        await base44.asServiceRole.entities.MfaAuditLog.create({
          user_id: user.id, email: user.email, event: 'otp_expired',
          detail: 'Code expired before verification',
        });
      } catch { /* audit failure must not fail the operation */ }
      return Response.json({ error: 'expired', message: 'Your code has expired. Please request a new one.' }, { status: 400 });
    }

    if ((mfaCode.attempts || 0) >= MAX_ATTEMPTS) {
      await base44.asServiceRole.entities.MfaCode.updateMany(
        { id: mfaCode.id, status: 'active' },
        { $set: { status: 'invalidated' } }
      );
      try {
        await base44.asServiceRole.entities.MfaAuditLog.create({
          user_id: user.id, email: user.email, event: 'otp_locked',
          detail: 'Max attempts exceeded before this request',
        });
      } catch { /* audit failure must not fail the operation */ }
      return Response.json({ error: 'too_many_attempts', message: 'Too many incorrect attempts. Please request a new code.' }, { status: 400 });
    }

    // --- VERIFY CODE HASH ---
    const candidateHash = await sha256Hex(mfaCode.salt + code);
    if (candidateHash !== mfaCode.code_hash) {
      // Wrong code: atomically increment attempts using $inc (genuinely atomic per-document).
      await base44.asServiceRole.entities.MfaCode.updateMany(
        { id: mfaCode.id, status: 'active' },
        { $inc: { attempts: 1 } }
      );
      const updated = await base44.asServiceRole.entities.MfaCode.get(mfaCode.id);
      const attempts = updated?.attempts || (mfaCode.attempts || 0) + 1;
      const lockedOut = attempts >= MAX_ATTEMPTS;
      if (lockedOut) {
        await base44.asServiceRole.entities.MfaCode.updateMany(
          { id: mfaCode.id, status: 'active' },
          { $set: { status: 'invalidated' } }
        );
      }
      try {
        await base44.asServiceRole.entities.MfaAuditLog.create({
          user_id: user.id, email: user.email,
          event: lockedOut ? 'otp_locked' : 'otp_failed',
          detail: `Incorrect code on attempt ${attempts}`,
        });
      } catch { /* audit failure must not fail the operation */ }
      const remaining = Math.max(0, MAX_ATTEMPTS - attempts);
      return Response.json({
        error: lockedOut ? 'too_many_attempts' : 'invalid',
        message: lockedOut
          ? 'Too many incorrect attempts. Please request a new code.'
          : `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        attempts_remaining: remaining,
      }, { status: 400 });
    }

    // --- CORRECT CODE: atomic CAS via updateMany to prevent double-verify ---
    const verificationToken = crypto.randomUUID();
    await base44.asServiceRole.entities.MfaCode.updateMany(
      { id: mfaCode.id, status: 'active' },
      { $set: { status: 'verified', verification_token: verificationToken } }
    );
    const verifiedCode = await base44.asServiceRole.entities.MfaCode.get(mfaCode.id);
    if (!verifiedCode || verifiedCode.status !== 'verified' || verifiedCode.verification_token !== verificationToken) {
      // Another concurrent request already verified this code.
      return Response.json({ error: 'already_used', message: 'This code has already been used.' }, { status: 409 });
    }

    // --- CREATE SESSION ---
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const sessionToken = btoa(String.fromCharCode(...tokenBytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const tokenHash = await sha256Hex(sessionToken);
    const deviceHash = await sha256Hex(req.headers.get('user-agent') || '');
    const sessionExpiresAt = new Date(now.getTime() + MFA_SESSION_TTL_MS).toISOString();

    // Atomically revoke all previous sessions for this user.
    await base44.asServiceRole.entities.MfaSession.updateMany(
      { user_id: user.id, revoked: false },
      { $set: { revoked: true } }
    );

    await base44.asServiceRole.entities.MfaSession.create({
      user_id: user.id,
      token_hash: tokenHash,
      device_hash: deviceHash,
      verified_at: now.toISOString(),
      expires_at: sessionExpiresAt,
      revoked: false,
    });

    try {
      await base44.asServiceRole.entities.MfaAuditLog.create({
        user_id: user.id, email: user.email, event: 'otp_verified',
        detail: 'MFA verification succeeded and a server session was issued',
      });
    } catch { /* audit failure must not fail the operation */ }

    return Response.json({
      success: true,
      verified_at: now.toISOString(),
      expires_at: sessionExpiresAt,
      session_token: sessionToken,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'verify_mfa_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error', message: 'Verification is temporarily unavailable.' }, { status: 500 });
  }
});