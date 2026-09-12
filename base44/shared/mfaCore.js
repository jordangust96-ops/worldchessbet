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