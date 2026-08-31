// Pure, runtime-agnostic MaxMind/GeoIP cost-safety gates and the jurisdiction
// verification cache-reuse predicate. NO Deno.env, NO Node APIs, NO network.
// Shared by the Deno backend handler
// (base44/functions/getCurrentJurisdiction/entry.ts) and the deterministic
// Node test (scripts/validate-jurisdiction-gates.mjs). Keep dependency-free so
// it imports unchanged in both runtimes.

// 15-minute freshness window for reusing a prior same-user/same-IP
// verification. Preserved unchanged from the original in-function constant.
export const VERIFICATION_CACHE_TTL_MS = 15 * 60 * 1000;

// Normal GeoIP enforcement requires BOTH explicit provider enablement
// (MAXMIND_GEOIP_ENABLED === 'true') AND Early Access Mode disabled. Setting
// MAXMIND_GEOIP_ENABLED=true now, while Early Access is still on, therefore
// does NOT cause any paid MaxMind lookup. At launch both conditions become true
// and a provider outage / missing configuration fails closed
// (verification_failed), which blocks the paid action.
export function isGeoipEnforcementEnabled(maxmindGeoipEnabled, earlyAccessMode) {
  return !!maxmindGeoipEnabled && !earlyAccessMode;
}

// Admin-initiated live lookups require, in addition to admin authorization
// (enforced by the caller via user.role === 'admin'), this explicit
// server-only gate. Defaults false (env unset), so an administrator cannot
// trigger a paid MaxMind call unless the gate is also explicitly enabled.
export function canAdminForceLiveCheck(maxmindAdminForceLiveChecks) {
  return !!maxmindAdminForceLiveChecks;
}

// Pure predicate: can a prior JurisdictionVerificationLog record be reused for
// the same user + IP within the TTL window? Only resolvable decisions are
// reused (approved / blocked, or verification_failed when a VPN/proxy was
// detected). No network, no DB. Mirrors the original in-function reuse logic
// exactly so the cache behavior is preserved bit-for-bit.
export function isReusableVerification(latest, ip, now, ttlMs) {
  if (!latest || latest.ip_address !== ip) return false;
  const windowMs = ttlMs == null ? VERIFICATION_CACHE_TTL_MS : ttlMs;
  const verifiedAtMs = Date.parse(latest.verified_at || latest.created_date || '');
  if (!Number.isFinite(verifiedAtMs) || now - verifiedAtMs > windowMs) return false;
  const computedStatus = latest.pre_bypass_verification_result || latest.verification_result;
  if (['approved', 'blocked'].includes(computedStatus)) return true;
  if (computedStatus === 'verification_failed' && !!latest.vpn_or_proxy_detected) return true;
  return false;
}