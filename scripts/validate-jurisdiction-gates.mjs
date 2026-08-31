// Deterministic, no-network verification of the MaxMind/GeoIP cost-safety
// gates and the jurisdiction verification cache-reuse predicate.
// Runs under plain Node (`node scripts/validate-jurisdiction-gates.mjs`) and
// makes NO requests to MaxMind. It exercises the pure helpers in
// base44/shared/jurisdictionGates.js end-to-end and statically asserts the
// getCurrentJurisdiction backend function wires both env gates correctly and
// preserves the fail-closed launch behavior and the 15-minute same-user/same-
// IP cache (matching the style of validate-seamless.mjs).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const {
  isGeoipEnforcementEnabled,
  canAdminForceLiveCheck,
  isReusableVerification,
  VERIFICATION_CACHE_TTL_MS,
} = await import('../base44/shared/jurisdictionGates.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const TTL = VERIFICATION_CACHE_TTL_MS;
const now = Date.parse('2026-08-31T17:00:00Z');
const freshIso = '2026-08-31T16:52:00Z';   // 8 min ago  -> within 15-min TTL
const expiredIso = '2026-08-31T16:40:00Z'; // 20 min ago -> beyond 15-min TTL

// ---------------- Provider gate (MAXMIND_GEOIP_ENABLED) ----------------
ok(isGeoipEnforcementEnabled(false, true) === false, 'provider off + EA on -> enforcement off (no paid lookup)');
ok(isGeoipEnforcementEnabled(true, true) === false, 'provider on + EA on -> enforcement off (setting gate now does NOT cause paid lookups)');
ok(isGeoipEnforcementEnabled(false, false) === false, 'provider off + EA off -> enforcement off (launch requires explicit provider enablement)');
ok(isGeoipEnforcementEnabled(true, false) === true, 'provider on + EA off -> enforcement on (both conditions met)');

// ---------------- Admin force-live gate (MAXMIND_ADMIN_FORCE_LIVE_CHECKS) ----------------
ok(canAdminForceLiveCheck(false) === false, 'admin force gate unset (default) -> cannot bypass cache/EA');
ok(canAdminForceLiveCheck(true) === true, 'admin force gate set -> may bypass (with admin role)');

// ---------------- Cache-reuse predicate (preserved behavior) ----------------
ok(isReusableVerification(null, '1.2.3.4', now) === false, 'no prior log -> not reusable');
ok(isReusableVerification(undefined, '1.2.3.4', now) === false, 'undefined log -> not reusable');
ok(isReusableVerification({ ip_address: '5.6.7.8', verified_at: freshIso, verification_result: 'approved' }, '1.2.3.4', now) === false, 'different IP -> not reusable');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: expiredIso, verification_result: 'approved' }, '1.2.3.4', now) === false, 'same IP but older than TTL -> not reusable');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: freshIso, verification_result: 'approved' }, '1.2.3.4', now) === true, 'same IP, fresh, approved -> reusable');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: freshIso, verification_result: 'blocked' }, '1.2.3.4', now) === true, 'same IP, fresh, blocked -> reusable');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: freshIso, verification_result: 'verification_failed', vpn_or_proxy_detected: true }, '1.2.3.4', now) === true, 'verification_failed + VPN -> reusable');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: freshIso, verification_result: 'verification_failed', vpn_or_proxy_detected: false }, '1.2.3.4', now) === false, 'verification_failed without VPN -> not reusable');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: freshIso, verification_result: 'unknown' }, '1.2.3.4', now) === false, 'unknown -> not reusable');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: freshIso, pre_bypass_verification_result: 'approved', verification_result: 'approved' }, '1.2.3.4', now) === true, 'pre_bypass approved honored');
ok(isReusableVerification({ ip_address: '1.2.3.4', created_date: freshIso, verification_result: 'approved' }, '1.2.3.4', now) === true, 'falls back to created_date when verified_at missing');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: freshIso, verification_result: 'approved' }, '1.2.3.4', now, TTL - 1000) === true, 'custom TTL window (within) respected');
ok(isReusableVerification({ ip_address: '1.2.3.4', verified_at: freshIso, verification_result: 'approved' }, '1.2.3.4', now, 1000) === false, 'custom TTL window (exceeded) respected');

// ---------------- Static wiring checks (entry.ts) ----------------
const entrySrc = await read('base44/functions/getCurrentJurisdiction/entry.ts');
ok(entrySrc.includes('isGeoipEnforcementEnabled('), 'entry.ts imports & calls isGeoipEnforcementEnabled');
ok(entrySrc.includes('canAdminForceLiveCheck('), 'entry.ts imports & calls canAdminForceLiveCheck');
ok(entrySrc.includes('isReusableVerification('), 'entry.ts delegates cache reuse to isReusableVerification');
ok(entrySrc.includes("MAXMIND_GEOIP_ENABLED"), 'entry.ts reads MAXMIND_GEOIP_ENABLED env gate');
ok(entrySrc.includes('MAXMIND_ADMIN_FORCE_LIVE_CHECKS'), 'entry.ts reads MAXMIND_ADMIN_FORCE_LIVE_CHECKS env gate');
ok(/liveCheckForcedByAdmin\s*=\s*forceLiveCheck\s*&&\s*user\.role\s*===\s*'admin'\s*&&\s*canAdminForceLiveCheck/.test(entrySrc), 'admin force-live requires admin role AND the server-only gate');
ok(/!ENABLE_GEOLOCATION_ENFORCEMENT\s*&&\s*status\s*!==\s*'approved'/.test(entrySrc), 'fail-closed bypass branch only fires when enforcement is disabled (preserved)');
ok(/!lookup\.ok/.test(entrySrc) && /status\s*=\s*'verification_failed'/.test(entrySrc), 'provider lookup failure -> verification_failed (fail-closed preserved)');
ok(!entrySrc.includes('VERIFICATION_CACHE_TTL_MS = 15'), 'TTL constant moved to the pure shared module (no duplicate)');

console.log(`jurisdiction-gates: ${pass} assertions passed (no network).`);