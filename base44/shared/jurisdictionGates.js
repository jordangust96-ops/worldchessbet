// Pure, runtime-agnostic MaxMind/GeoIP cost-safety gates and the jurisdiction
// verification cache-reuse predicate. NO Deno.env, NO Node APIs, NO network.
// Shared by the Deno backend handler
// (base44/functions/getCurrentJurisdiction/entry.ts) and the deterministic
// Node test (scripts/validate-jurisdiction-gates.mjs). Keep dependency-free so
// it imports unchanged in both runtimes.

// 15-minute freshness window for reusing a prior same-user/same-IP
// verification. Preserved unchanged from the original in-function constant.
export const VERIFICATION_CACHE_TTL_MS = 15 * 60 * 1000;

// GeoIP enforcement is controlled solely by MAXMIND_GEOIP_ENABLED.
// EARLY_ACCESS_MODE no longer disables MaxMind — location enforcement is
// activated independently of the Early Access money gates, which still block
// real deposits/withdrawals/settlement. When MAXMIND_GEOIP_ENABLED is true,
// fresh lookups run at the app-access and paid-action boundaries; a provider
// outage / missing configuration fails closed (verification_failed), which
// blocks the action.
export function isGeoipEnforcementEnabled(maxmindGeoipEnabled) {
  return Boolean(maxmindGeoipEnabled);
}

// Admin-initiated live lookups require, in addition to admin authorization
// (enforced by the caller via user.role === 'admin'), this explicit
// server-only gate. Defaults false (env unset), so an administrator cannot
// trigger a paid MaxMind call unless the gate is also explicitly enabled.
export function canAdminForceLiveCheck(maxmindAdminForceLiveChecks) {
  return !!maxmindAdminForceLiveChecks;
}

// Pure predicate: can a prior JurisdictionVerificationLog record be reused for
// the same user + exact same IP within the TTL window? Returns true only when
// ALL of the following hold: the record exists; record.user_id equals the
// requested user id; record.ip_address exactly equals the requested IP;
// record.provider is exactly "MaxMind"; record.geolocation_enforcement_enabled
// is true; record.enforcement_bypassed is not true; record.verification_result
// is "approved" or "blocked"; record.verified_at is a valid date no older than
// the supplied TTL and not in the future. So bypassed/disabled/providerless,
// stale, future, wrong-user/IP, and verification_failed/unknown records are
// never reusable — the earlier activation-test bypass cannot be reused once
// enforcement is active.
export function isReusableVerification(latest, ip, now, ttlMs, userId) {
  if (!latest) return false;
  if (latest.user_id !== userId) return false;
  if (latest.ip_address !== ip) return false;
  if (latest.provider !== 'MaxMind') return false;
  if (latest.geolocation_enforcement_enabled !== true) return false;
  if (latest.enforcement_bypassed === true) return false;
  const result = latest.verification_result;
  if (result !== 'approved' && result !== 'blocked') return false;
  const verifiedAtMs = Date.parse(latest.verified_at);
  if (!Number.isFinite(verifiedAtMs)) return false;
  const windowMs = ttlMs == null ? VERIFICATION_CACHE_TTL_MS : ttlMs;
  if (now - verifiedAtMs > windowMs || now - verifiedAtMs < 0) return false;
  return true;
}