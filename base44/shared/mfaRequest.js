import {
  sha256Hex,
  generateOtp,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_REQUESTS_PER_HOUR,
  MAX_ATTEMPTS,
  isValidTimestamp,
  isExpired,
  cooldownRemaining,
} from './mfaCore.js';
import { buildMfaEmail } from './mfaEmail.js';

// Process an MFA OTP request. Pure logic with a mockable store and emailSender.
// Returns { status, body }.
//
// store interface:
//   getRecentCodes(userId, limit) -> Promise<MfaCode[]>  (sorted -created_date)
//   getActiveCodes(userId, limit) -> Promise<MfaCode[]>  (status='active', sorted -created_date)
//   createCode(data) -> Promise<MfaCode>
//   updateCode(userId, codeId, filter, update) -> Promise<any>  (filter merged into {user_id, id, ...filter})
//   audit(userId, email, event, detail) -> Promise<void>  (must not throw)
//
// emailSender: (to, subject, body, fromName) -> Promise<void> (throws on failure)
//
// LIMITATION: There is no atomic "create-or-return-existing" primitive in the
// Base44 SDK. Two concurrent requests can both create codes and both send
// emails. The deterministic resolution is: after successful delivery, each
// request invalidates strictly OLDER active codes (by created_date). The newer
// delivered code wins. This is not a lock — duplicate emails can still be sent
// in the concurrent window, but only one code remains valid.
export async function processRequest({ mode, user, store, emailSender, now = new Date() }) {
  const recentCodes = await store.getRecentCodes(user.id, 10);

  // Find an existing delivered, active, non-expired challenge.
  const deliveredActive = recentCodes.find(
    (c) => c.status === 'active' &&
          c.delivery_status === 'delivered' &&
          isValidTimestamp(c.expires_at) &&
          !isExpired(c.expires_at, now)
  );

  // RESUME: return existing delivered active challenge without issuing a new one.
  if (mode === 'resume' && deliveredActive) {
    return {
      status: 200,
      body: {
        success: true,
        resumed: true,
        expires_at: deliveredActive.expires_at,
        cooldown_seconds: cooldownRemaining(deliveredActive.created_date, now),
        attempts_remaining: MAX_ATTEMPTS - (deliveredActive.attempts || 0),
      },
    };
  }

  // --- Cooldown applies to EVERY issuance (both resume-without-code and resend) ---
  const lastCode = recentCodes[0];
  if (lastCode && isValidTimestamp(lastCode.created_date)) {
    const remaining = cooldownRemaining(lastCode.created_date, now);
    if (remaining > 0) {
      return {
        status: 429,
        body: {
          error: 'cooldown',
          retry_after_seconds: remaining,
          message: `Please wait ${remaining}s before requesting another code.`,
          expires_at: deliveredActive?.expires_at || null,
          attempts_remaining: deliveredActive ? MAX_ATTEMPTS - (deliveredActive.attempts || 0) : 0,
        },
      };
    }
  }

  // --- Hourly rate limit ---
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const requestsLastHour = recentCodes.filter(
    (c) => isValidTimestamp(c.created_date) && new Date(c.created_date) > oneHourAgo
  ).length;
  if (requestsLastHour >= MAX_REQUESTS_PER_HOUR) {
    const oldestInWindow = recentCodes
      .filter((c) => isValidTimestamp(c.created_date) && new Date(c.created_date) > oneHourAgo)
      .sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime())[0];
    const retryAfter = oldestInWindow
      ? Math.ceil((new Date(oldestInWindow.created_date).getTime() + 60 * 60 * 1000 - now.getTime()) / 1000)
      : 3600;
    await store.audit(user.id, user.email, 'rate_limited', 'Too many OTP requests within an hour');
    return {
      status: 429,
      body: {
        error: 'rate_limited',
        retry_after_seconds: retryAfter,
        message: 'Too many verification code requests. Please try again later.',
      },
    };
  }

  // --- Generate new code (pending delivery) ---
  const code = generateOtp();
  const salt = crypto.randomUUID();
  const codeHash = await sha256Hex(salt + code);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();

  const newCode = await store.createCode({
    user_id: user.id,
    email: user.email,
    code_hash: codeHash,
    salt,
    expires_at: expiresAt,
    attempts: 0,
    status: 'active',
    delivery_status: 'pending',
  });

  // --- Send email ---
  try {
    await emailSender(user.email, 'Your ChessBet verification code', buildMfaEmail(code, OTP_TTL_MS / 60000), 'ChessBet');
  } catch {
    // Email failed — invalidate the code. Do NOT return success.
    await store.updateCode(
      user.id, newCode.id,
      { status: 'active', delivery_status: 'pending' },
      { $set: { status: 'invalidated', delivery_status: 'failed' } }
    );
    await store.audit(user.id, user.email, 'otp_failed', 'Email delivery failed during OTP request');
    return {
      status: 502,
      body: {
        error: 'delivery_failed',
        message: 'We couldn\'t send your verification code. Please try again in a moment.',
      },
    };
  }

  // --- Email succeeded: mark as delivered ---
  await store.updateCode(
    user.id, newCode.id,
    { status: 'active', delivery_status: 'pending' },
    { $set: { delivery_status: 'delivered' } }
  );

  // --- Invalidate strictly OLDER active codes (never newer, never self) ---
  // Deterministic ordering by created_date: only codes older than this code
  // are invalidated. This prevents two concurrent senders from invalidating
  // each other — the newer one always wins, the older one is always invalidated.
  const newCreatedMs = new Date(newCode.created_date).getTime();
  const allActive = await store.getActiveCodes(user.id, 20);
  await Promise.all(
    allActive
      .filter((c) => c.id !== newCode.id && new Date(c.created_date).getTime() < newCreatedMs)
      .map((c) =>
        store.updateCode(user.id, c.id, { status: 'active' }, { $set: { status: 'invalidated' } })
      )
  );

  await store.audit(user.id, user.email, 'otp_requested', 'OTP generated and sent to email');

  return {
    status: 200,
    body: {
      success: true,
      expires_at: expiresAt,
      cooldown_seconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
      attempts_remaining: MAX_ATTEMPTS,
    },
  };
}