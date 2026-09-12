import {
  sha256Hex,
  normalizeOtpCode,
  isValidTimestamp,
  isExpired,
  isLockedOut,
  MAX_ATTEMPTS,
  MFA_SESSION_TTL_MS,
} from './mfaCore.js';

// Process an MFA OTP verification. Pure logic with a mockable store.
// Returns { status, body }.
//
// store interface:
//   getActiveCodes(userId, limit) -> Promise<MfaCode[]>  (status='active', sorted -created_date)
//   getCode(userId, codeId) -> Promise<MfaCode | null>
//   updateCode(userId, codeId, filter, update) -> Promise<any>
//   createSession(data) -> Promise<MfaSession>
//   revokeSessions(userId) -> Promise<any>
//   audit(userId, email, event, detail) -> Promise<void>  (must not throw)
export async function processVerify({ code, user, store, userAgent = '', now = new Date() }) {
  const normalized = normalizeOtpCode(code);
  if (!normalized) {
    return { status: 400, body: { error: 'invalid', message: 'Please enter the 6-digit code.' } };
  }

  const codes = await store.getActiveCodes(user.id, 10);
  // Find the newest delivered active code.
  const mfaCode = codes.find((c) => c.delivery_status === 'delivered');

  if (!mfaCode) {
    // Check if there's a pending code (email still being sent).
    const pendingCode = codes.find((c) => c.delivery_status === 'pending');
    if (pendingCode) {
      return {
        status: 400,
        body: { error: 'pending', message: 'Your code is still being delivered. Please wait a moment and try again.' },
      };
    }
    await store.audit(user.id, user.email, 'otp_failed', 'No active delivered code found for user');
    return {
      status: 400,
      body: { error: 'invalid', message: 'No active verification code. Please request a new one.' },
    };
  }

  // --- Expiry: >= not >, reject invalid timestamps ---
  if (isExpired(mfaCode.expires_at, now)) {
    await store.updateCode(user.id, mfaCode.id, { status: 'active' }, { $set: { status: 'expired' } });
    await store.audit(user.id, user.email, 'otp_expired', 'Code expired before verification');
    return { status: 400, body: { error: 'expired', message: 'Your code has expired. Please request a new one.' } };
  }

  // --- Pre-check lockout (informational; the CAS below enforces atomically) ---
  if (isLockedOut(mfaCode.attempts)) {
    await store.updateCode(user.id, mfaCode.id, { status: 'active' }, { $set: { status: 'invalidated' } });
    await store.audit(user.id, user.email, 'otp_locked', 'Max attempts exceeded before this request');
    return { status: 400, body: { error: 'too_many_attempts', message: 'Too many incorrect attempts. Please request a new code.' } };
  }

  // --- Verify code hash ---
  const candidateHash = await sha256Hex(mfaCode.salt + normalized);
  if (candidateHash !== mfaCode.code_hash) {
    // Wrong code: bounded atomic $inc (only if attempts < MAX_ATTEMPTS).
    await store.updateCode(
      user.id, mfaCode.id,
      { status: 'active', attempts: { $lt: MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } }
    );
    const updated = await store.getCode(user.id, mfaCode.id);
    const attempts = updated ? (updated.attempts || 0) : (mfaCode.attempts || 0) + 1;
    const lockedOut = attempts >= MAX_ATTEMPTS;
    if (lockedOut) {
      await store.updateCode(user.id, mfaCode.id, { status: 'active' }, { $set: { status: 'invalidated' } });
    }
    await store.audit(
      user.id, user.email,
      lockedOut ? 'otp_locked' : 'otp_failed',
      `Incorrect code on attempt ${attempts}`
    );
    const remaining = Math.max(0, MAX_ATTEMPTS - attempts);
    return {
      status: 400,
      body: {
        error: lockedOut ? 'too_many_attempts' : 'invalid',
        message: lockedOut
          ? 'Too many incorrect attempts. Please request a new code.'
          : `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        attempts_remaining: remaining,
      },
    };
  }

  // --- Correct code: atomic CAS with full predicate ---
  // The filter includes attempts < MAX_ATTEMPTS and expires_at >= now, so a
  // racing fifth wrong attempt or expiry cannot bypass this transition.
  const verificationToken = crypto.randomUUID();
  const nowISO = now.toISOString();
  await store.updateCode(
    user.id, mfaCode.id,
    { status: 'active', attempts: { $lt: MAX_ATTEMPTS }, expires_at: { $gte: nowISO } },
    { $set: { status: 'verified', verification_token: verificationToken } }
  );
  const verifiedCode = await store.getCode(user.id, mfaCode.id);
  if (!verifiedCode || verifiedCode.status !== 'verified' || verifiedCode.verification_token !== verificationToken) {
    // Another concurrent request already verified, or the code was locked
    // out / expired in the race window.
    return { status: 409, body: { error: 'already_used', message: 'This code has already been used or is no longer valid.' } };
  }

  // --- Create session ---
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const sessionToken = btoa(String.fromCharCode(...tokenBytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const tokenHash = await sha256Hex(sessionToken);
  const deviceHash = await sha256Hex(userAgent || '');
  const sessionExpiresAt = new Date(now.getTime() + MFA_SESSION_TTL_MS).toISOString();

  // Revoke all previous sessions for this user.
  await store.revokeSessions(user.id);

  await store.createSession({
    user_id: user.id,
    token_hash: tokenHash,
    device_hash: deviceHash,
    verified_at: now.toISOString(),
    expires_at: sessionExpiresAt,
    revoked: false,
  });

  await store.audit(user.id, user.email, 'otp_verified', 'MFA verification succeeded and a server session was issued');

  return {
    status: 200,
    body: {
      success: true,
      verified_at: now.toISOString(),
      expires_at: sessionExpiresAt,
      session_token: sessionToken,
    },
  };
}

// Validate an MFA session token. Pure logic with a mockable store.
// Returns { valid: boolean, expired?: boolean, bypass?: boolean, reason?: string, expires_at?: string }.
export async function processValidateSession({ sessionToken, user, store, userAgent = '', now = new Date() }) {
  if (!user) return { valid: false, reason: 'no_user' };

  // Administrators can grant a permanent MFA bypass for account recovery.
  if (user.mfa_bypass === true) {
    return { valid: true, bypass: true };
  }

  if (typeof sessionToken !== 'string' || sessionToken.length < 32 || sessionToken.length > 256) {
    return { valid: false, reason: 'invalid_token' };
  }

  const tokenHash = await sha256Hex(sessionToken);
  const sessions = await store.getSessions(user.id, tokenHash);
  const session = sessions[0];
  if (!session || session.revoked) {
    return { valid: false, reason: 'not_found' };
  }

  if (isExpired(session.expires_at, now)) {
    await store.revokeSession(user.id, session.id);
    return { valid: false, expired: true, reason: 'expired' };
  }

  const deviceHash = await sha256Hex(userAgent || '');
  if (deviceHash !== session.device_hash) {
    await store.revokeSession(user.id, session.id);
    await store.audit(user.id, user.email, 'session_rejected', 'MFA session device binding mismatch');
    return { valid: false, reason: 'device_mismatch' };
  }

  return { valid: true, expires_at: session.expires_at };
}