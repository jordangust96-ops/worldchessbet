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
// financial actions. When MAXMIND_GEOIP_ENABLED is true,
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
  if (!latest || !hasReliableLocationEvidence(latest)) return false;
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
 
// Minimum evidence quality for both new decisions and historical approvals.
// IP location remains an estimate; browser evidence can veto, never grant.
// On ChessBet's Base44 ingress, CF-Connecting-IP identifies an internal hop.
// True-Client-IP preserves the visitor address. Live forged-header probes on
// both base44.app and worldchessbet.com confirmed it is replaced at ingress.
// Never fall back to CF-Connecting-IP or a client-influenced forwarded chain.
export function getOriginalClientIp(req) {
  const ip = String(req?.headers?.get('true-client-ip') || '').trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split('.').every(part => Number(part) <= 255 && String(Number(part)) === part) ? ip : '';
  }
  if (!ip.includes(':') || !/^[0-9a-f:]+$/i.test(ip)) return '';
  try { return new URL('http://[' + ip + ']/').hostname.slice(1,-1); }
  catch { return ''; }
}
export const MIN_STATE_CONFIDENCE = 90;
export const MAX_LOCATION_RADIUS_KM = 100;
export function hasReliableLocationEvidence(row) {
  return Number.isFinite(row?.country_confidence) && row.country_confidence >= 50 &&
    row.country_confidence <= 100 &&
    Number.isFinite(row?.subdivision_confidence) && row.subdivision_confidence >= MIN_STATE_CONFIDENCE &&
    row.subdivision_confidence <= 100 &&
    Number.isFinite(row?.accuracy_radius_km) && row.accuracy_radius_km >= 0 &&
    row.accuracy_radius_km <= MAX_LOCATION_RADIUS_KM &&
    row.geo_mismatch_flag !== true && row.vpn_or_proxy_detected === false &&
    !['is_anonymous_vpn','is_anonymous_proxy','is_public_proxy','is_hosting_provider',
      'is_anonymous','is_tor_exit_node','is_residential_proxy','is_anycast','is_satellite_provider'].some(k=>row[k]===true);
}
