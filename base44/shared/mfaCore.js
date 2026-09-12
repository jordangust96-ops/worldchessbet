// Shared MFA constants and helpers used by requestMfaOtp and verifyMfaOtp.
// Do not duplicate these across functions — import from here.

export const OTP_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_REQUESTS_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;
export const MFA_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateOtp() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % 1000000).toString().padStart(6, '0');
}

// Normalize a user-submitted code: trim, strip whitespace/dashes, validate 6 digits.
// Returns the cleaned 6-digit string, or null if invalid.
export function normalizeOtpCode(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/[\s-]/g, '');
  return /^\d{6}$/.test(cleaned) ? cleaned : null;
}

// Returns true if the date string is a valid, parseable timestamp.
export function isValidTimestamp(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

// Expiry check: returns true if the code has expired or has an invalid timestamp.
// Uses >= so exact-expiry is treated as expired (no grace second).
export function isExpired(expiresAtStr, now = new Date()) {
  if (!isValidTimestamp(expiresAtStr)) return true;
  return now.getTime() >= new Date(expiresAtStr).getTime();
}

// Returns true if the code is locked out due to too many wrong attempts.
export function isLockedOut(attempts, maxAttempts = MAX_ATTEMPTS) {
  return (Number(attempts) || 0) >= maxAttempts;
}

// Compute remaining cooldown seconds for a code created at createdDate.
export function cooldownRemaining(createdDateStr, now = new Date(), cooldownMs = RESEND_COOLDOWN_MS) {
  if (!isValidTimestamp(createdDateStr)) return 0;
  const elapsed = now.getTime() - new Date(createdDateStr).getTime();
  return Math.max(0, Math.ceil((cooldownMs - elapsed) / 1000));
}

// Deterministic total order for MFA codes: newer = later created_date, then
// later unique id when timestamps tie (same millisecond). Returns negative if
// a is older, positive if a is newer, 0 only for the same record (same id).
// Used consistently in request invalidation, resume selection, and verify
// selection so equal-timestamp codes never leave multiple valid winners.
export function compareCodes(a, b) {
  const aMs = isValidTimestamp(a?.created_date) ? new Date(a.created_date).getTime() : 0;
  const bMs = isValidTimestamp(b?.created_date) ? new Date(b.created_date).getTime() : 0;
  if (aMs !== bMs) return aMs - bMs;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}