// Deterministic, no-network verification of the MaxMind/GeoIP cost-safety
// gates, the jurisdiction verification cache-reuse predicate, the pure
// frontend jurisdiction-access decision helper, and the static wiring of the
// authenticated access guard + backend enforcement call sites.
//
// Runs under plain Node (`node scripts/validate-jurisdiction-gates.mjs`),
// makes NO requests to MaxMind or Base44, imports NO JSX, and invokes NO
// backend function/service — it exercises the pure helpers in
// base44/shared/jurisdictionGates.js and src/lib/jurisdictionAccess.js
// end-to-end, and statically asserts the source files wire enforcement
// correctly (matching the style of validate-seamless.mjs).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const {
  isGeoipEnforcementEnabled,
  canAdminForceLiveCheck,
  isReusableVerification,
  VERIFICATION_CACHE_TTL_MS,
} = await import('../base44/shared/jurisdictionGates.js');

const { APPROVED_STATES } = await import('../src/lib/jurisdictionConfig.js');
const { evaluateJurisdictionAccess, getJurisdictionCheck } = await import('../src/lib/jurisdictionAccess.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); pass++; };

const TTL = VERIFICATION_CACHE_TTL_MS;
const now = Date.parse('2026-08-31T17:00:00Z');
const freshIso = '2026-08-31T16:52:00Z';   // 8 min ago  -> within 15-min TTL
const expiredIso = '2026-08-31T16:40:00Z'; // 20 min ago -> beyond 15-min TTL
const futureIso = '2026-08-31T17:10:00Z';  // 10 min ahead -> future, not reusable
const UID = 'user_123';
const IP = '1.2.3.4';

// ---------- 1. Authoritative allowlist ----------
eq(APPROVED_STATES, ['AR', 'CO', 'GA', 'IA', 'KS', 'ND', 'TX', 'VA', 'WI', 'WY'], 'approved states allowlist is the exact Tier 1 set');
ok(APPROVED_STATES.length === 10, 'allowlist has exactly 10 entries');
ok(new Set(APPROVED_STATES).size === 10, 'allowlist entries are unique');

// ---------- 2. Provider gate (MAXMIND_GEOIP_ENABLED) ----------
ok(isGeoipEnforcementEnabled(false) === false, 'provider off -> enforcement off');
ok(isGeoipEnforcementEnabled(true) === true, 'provider on -> enforcement on');
const gatesSrc = await read('base44/shared/jurisdictionGates.js');
ok(/export function isGeoipEnforcementEnabled\s*\(\s*maxmindGeoipEnabled\s*\)/.test(gatesSrc), 'isGeoipEnforcementEnabled depends only on the provider flag');

// ---------- Admin force-live gate (MAXMIND_ADMIN_FORCE_LIVE_CHECKS) ----------
ok(canAdminForceLiveCheck(false) === false, 'admin force gate unset (default) -> cannot bypass cache');
ok(canAdminForceLiveCheck(true) === true, 'admin force gate set -> may bypass (with admin role)');

// ---------- 5. Cache-reuse predicate (tightened behavior) ----------
const reusableBase = (overrides = {}) => ({
  user_id: UID,
  ip_address: IP,
  provider: 'MaxMind',
  geolocation_enforcement_enabled: true,
  enforcement_bypassed: false,
  verification_result: 'approved',
  verified_at: freshIso,
  ...overrides,
});

ok(isReusableVerification(null, IP, now, undefined, UID) === false, 'no prior log -> not reusable');
ok(isReusableVerification(undefined, IP, now, undefined, UID) === false, 'undefined log -> not reusable');
ok(isReusableVerification(reusableBase(), IP, now, undefined, UID) === true, 'fresh same-user exact-IP real-MaxMind approved (enforcement on, not bypassed) -> reusable');
ok(isReusableVerification(reusableBase({ verification_result: 'blocked' }), IP, now, undefined, UID) === true, 'fresh same-user exact-IP blocked -> reusable');
// Rejections (each one must fail closed):
ok(isReusableVerification(reusableBase({ user_id: 'other_user' }), IP, now, undefined, UID) === false, 'wrong user -> not reusable');
ok(isReusableVerification(reusableBase({ ip_address: '5.6.7.8' }), IP, now, undefined, UID) === false, 'wrong IP -> not reusable');
ok(isReusableVerification(reusableBase({ provider: undefined }), IP, now, undefined, UID) === false, 'providerless record -> not reusable');
ok(isReusableVerification(reusableBase({ provider: 'GeoLite' }), IP, now, undefined, UID) === false, 'wrong provider -> not reusable');
ok(isReusableVerification(reusableBase({ geolocation_enforcement_enabled: false }), IP, now, undefined, UID) === false, 'enforcement disabled -> not reusable');
ok(isReusableVerification(reusableBase({ geolocation_enforcement_enabled: undefined }), IP, now, undefined, UID) === false, 'enforcement flag missing -> not reusable');
ok(isReusableVerification(reusableBase({ enforcement_bypassed: true }), IP, now, undefined, UID) === false, 'bypassed record -> not reusable');
ok(isReusableVerification(reusableBase({ verification_result: 'unknown' }), IP, now, undefined, UID) === false, 'unknown result -> not reusable');
ok(isReusableVerification(reusableBase({ verification_result: 'verification_failed' }), IP, now, undefined, UID) === false, 'verification_failed result -> not reusable');
ok(isReusableVerification(reusableBase({ verification_result: 'error' }), IP, now, undefined, UID) === false, 'error result -> not reusable');
ok(isReusableVerification(reusableBase({ verified_at: undefined }), IP, now, undefined, UID) === false, 'missing timestamp -> not reusable');
ok(isReusableVerification(reusableBase({ verified_at: 'not-a-date' }), IP, now, undefined, UID) === false, 'invalid timestamp -> not reusable');
ok(isReusableVerification(reusableBase({ verified_at: futureIso }), IP, now, undefined, UID) === false, 'future timestamp -> not reusable');
ok(isReusableVerification(reusableBase({ verified_at: expiredIso }), IP, now, undefined, UID) === false, 'expired timestamp (beyond TTL) -> not reusable');
ok(isReusableVerification(reusableBase({ verified_at: undefined, created_date: freshIso }), IP, now, undefined, UID) === false, 'created_date no longer substitutes for a missing verified_at (tightened)');
ok(isReusableVerification(reusableBase(), IP, now, TTL - 1000, UID) === true, 'custom TTL window (within) respected');
ok(isReusableVerification(reusableBase(), IP, now, 1000, UID) === false, 'custom TTL window (exceeded) respected');

// ---------- 3 & 4. evaluateJurisdictionAccess (pure frontend decision) ----------
const accessApproved = { enforcementEnabled: true, status: 'approved', approved: true, country: 'US', state: 'TX' };
ok(evaluateJurisdictionAccess(accessApproved).allowed === true, 'enforcement on + approved + US + approved state + no VPN -> allowed');
// The only positive shape; everything else fails closed:
ok(evaluateJurisdictionAccess(null).allowed === false, 'missing response -> not allowed');
ok(evaluateJurisdictionAccess(undefined).allowed === false, 'undefined response -> not allowed');
ok(evaluateJurisdictionAccess({}).allowed === false, 'empty response -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, state: 'MI' }).allowed === false, 'other U.S. state -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, country: 'CA', state: 'ON' }).allowed === false, 'non-US country -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, state: '' }).allowed === false, 'missing state -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, country: '' }).allowed === false, 'missing country -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, country: undefined }).allowed === false, 'undefined country -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, enforcementEnabled: false }).allowed === false, 'enforcement disabled -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, enforcementEnabled: undefined }).allowed === false, 'enforcement flag missing -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, status: 'blocked' }).allowed === false, 'blocked -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, status: 'unknown' }).allowed === false, 'unknown -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, status: 'verification_failed' }).allowed === false, 'verification_failed -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, status: 'error' }).allowed === false, 'error status -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, approved: false }).allowed === false, 'approved=false -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, status: 'blocked', approved: true }).allowed === false, 'approved=true but status not approved -> not allowed');
ok(evaluateJurisdictionAccess({ ...accessApproved, vpnDetected: true }).allowed === false, 'vpnDetected -> not allowed');
for (const flag of ['isAnonymousVpn', 'isAnonymousProxy', 'isPublicProxy', 'isHostingProvider', 'isAnonymous', 'isTorExitNode', 'isResidentialProxy']) {
  ok(evaluateJurisdictionAccess({ ...accessApproved, [flag]: true }).allowed === false, `${flag} true -> not allowed`);
}

// The pure module must import the allowlist via a relative ESM path (so the
// Node test can import it without Vite alias resolution).
const accessSrc = await read('src/lib/jurisdictionAccess.js');
ok(accessSrc.includes('./jurisdictionConfig.js'), 'jurisdictionAccess imports jurisdictionConfig via relative ESM path');
ok(!accessSrc.includes('@/lib/jurisdictionConfig'), 'jurisdictionAccess does not use the Vite alias (Node-importable)');

// ---------- 6. getJurisdictionCheck (in-flight deduplication, no resolved-approval cache) ----------
{
  let calls = 0;
  const invoke = () => { calls++; return Promise.resolve({ status: 'approved' }); };
  // Concurrent same-user calls share one promise -> invoke fires once.
  const a = getJurisdictionCheck(UID, invoke);
  const b = getJurisdictionCheck(UID, invoke);
  ok(a === b, 'concurrent same-user calls return the same in-flight promise');
  await a; await b;
  ok(calls === 1, 'concurrent same-user calls invoke the provider exactly once');
  // A different user does not share the first user's promise.
  const c = getJurisdictionCheck('user_456', invoke);
  await c;
  ok(calls === 2, 'a different user invokes a separate call (no cross-user sharing)');
  // After the first user's promise has settled and been cleared, a later call
  // for that same user invokes again — there is no resolved-approval cache.
  const d = getJurisdictionCheck(UID, invoke);
  await d;
  ok(calls === 3, 'after settle, a later same-user call invokes again (no resolved-approval cache)');
  // Missing user id is a programmer error and rejects without creating a Map entry.
  let rejected = false;
  try { await getJurisdictionCheck('', invoke); } catch { rejected = true; }
  ok(rejected, 'missing user id rejects (no Map entry created)');
  ok(calls === 3, 'rejected missing-id call did not invoke the provider');
}

// ---------- Static wiring checks (getCurrentJurisdiction backend) ----------
const entrySrc = await read('base44/functions/getCurrentJurisdiction/entry.ts');
ok(entrySrc.includes('isGeoipEnforcementEnabled('), 'entry.ts imports & calls isGeoipEnforcementEnabled');
ok(entrySrc.includes('canAdminForceLiveCheck('), 'entry.ts imports & calls canAdminForceLiveCheck');
ok(entrySrc.includes('isReusableVerification('), 'entry.ts delegates cache reuse to isReusableVerification');
ok(entrySrc.includes('MAXMIND_GEOIP_ENABLED'), 'entry.ts reads MAXMIND_GEOIP_ENABLED env gate');
ok(entrySrc.includes('MAXMIND_ADMIN_FORCE_LIVE_CHECKS'), 'entry.ts reads MAXMIND_ADMIN_FORCE_LIVE_CHECKS env gate');
ok(/liveCheckForcedByAdmin\s*=\s*forceLiveCheck\s*&&\s*user\.role\s*===\s*'admin'\s*&&\s*canAdminForceLiveCheck/.test(entrySrc), 'admin force-live requires admin role AND the server-only gate');
ok(entrySrc.includes('providerConfigurationUnavailable'), 'disabled or missing MaxMind configuration has an explicit fail-closed path');
ok(/providerConfigurationUnavailable\)\s*\{\s*status\s*=\s*'verification_failed'/.test(entrySrc), 'disabled or missing MaxMind configuration -> verification_failed');
ok(!/status:\s*'approved'[\s\S]{0,400}verificationSkipped:\s*true/.test(entrySrc), 'no disabled-provider approved bypass remains');
ok(/!lookup\.ok/.test(entrySrc) && /status\s*=\s*'verification_failed'/.test(entrySrc), 'provider lookup failure -> verification_failed (fail-closed preserved)');
ok(!entrySrc.includes('VERIFICATION_CACHE_TTL_MS = 15'), 'TTL constant moved to the pure shared module (no duplicate)');

// ---------- 7. Authenticated application route order + guard constraints ----------
const appSrc = await read('src/AuthenticatedApplication.jsx');
const prIdx = appSrc.indexOf('<Route element={<ProtectedRoute');
const guardIdx = appSrc.indexOf('<Route element={<JurisdictionAccessGuard');
const mfaIdx = appSrc.indexOf('<Route element={<MfaGuard');
const policyIdx = appSrc.indexOf('<Route element={<PolicyAcceptanceGuard');
ok(prIdx !== -1 && guardIdx !== -1 && mfaIdx !== -1 && policyIdx !== -1, 'ProtectedRoute, JurisdictionAccessGuard, MfaGuard, PolicyAcceptanceGuard route elements all present');
ok(prIdx < guardIdx, 'ProtectedRoute (auth) precedes JurisdictionAccessGuard');
ok(guardIdx < mfaIdx, 'JurisdictionAccessGuard precedes MfaGuard');
ok(mfaIdx < policyIdx, 'MfaGuard precedes PolicyAcceptanceGuard');
// Public / marketing / legal / auth / support routes and /join stay outside the protected block.
ok(appSrc.indexOf('/join/:inviteCode') < prIdx, '/join/:inviteCode remains outside the ProtectedRoute block');
ok(appSrc.indexOf('path="/privacy-policy"') < prIdx, 'public /privacy-policy remains outside the ProtectedRoute block');
ok(appSrc.indexOf('path="/faq"') < prIdx, 'public /faq remains outside the ProtectedRoute block');
ok(appSrc.indexOf('path="/login"') < prIdx, 'public /login remains outside the ProtectedRoute block');

const guardSrc = await read('src/components/JurisdictionAccessGuard.jsx');
ok(/triggerEvent:\s*["']app_access["']/.test(guardSrc), 'guard invokes getCurrentJurisdiction with triggerEvent app_access');
ok(!/Retry/.test(guardSrc), 'guard has no retry button');
ok(!/setTimeout|setInterval/.test(guardSrc), 'guard has no timer');
ok(!/addEventListener/.test(guardSrc), 'guard has no focus/visibility/navigation listener');
ok(!/useNavigate/.test(guardSrc), 'guard has no navigation listener');
ok(!/localStorage|sessionStorage/.test(guardSrc), 'guard uses no localStorage/sessionStorage');
ok(guardSrc.includes("<Outlet />"), 'guard renders <Outlet /> when allowed');

// ---------- 8. Backend enforcement call sites (preserved) ----------
const createSrc = await read('base44/functions/createMatch/entry.ts');
ok(createSrc.includes('runContestEligibility'), 'createMatch invokes runContestEligibility (jurisdiction gate)');
ok(/triggerEvent:\s*['"]create_match['"]/.test(createSrc), 'createMatch passes triggerEvent create_match');
ok(/!eligibilityRes\.data\?\.eligible/.test(createSrc), 'createMatch fails closed when not eligible');

const acceptSrc = await read('base44/functions/acceptMatch/entry.ts');
ok(acceptSrc.includes('runContestEligibility'), 'acceptMatch invokes runContestEligibility (jurisdiction gate)');
ok(/triggerEvent:\s*['"]accept_match['"]/.test(acceptSrc), 'acceptMatch passes triggerEvent accept_match');
ok(/!eligibilityRes\.data\?\.eligible/.test(acceptSrc), 'acceptMatch fails closed when not eligible');

const lockSrc = await read('base44/functions/lockWager/entry.ts');
ok(lockSrc.includes('getCurrentJurisdiction'), 'lockWager invokes getCurrentJurisdiction (final gate before funds)');
ok(/triggerEvent:\s*['"]lock_wager['"]/.test(lockSrc), 'lockWager passes triggerEvent lock_wager');
ok(/jurisdictionRes\.data\?\.status\s*!==\s*['"]approved['"]/.test(lockSrc), 'lockWager fails closed unless jurisdiction status is approved');

const depositSrc = await read('base44/functions/submitSeamlessDeposit/entry.ts');
ok(depositSrc.includes('getCurrentJurisdiction'), 'submitSeamlessDeposit invokes getCurrentJurisdiction');
ok(/triggerEvent:\s*['"]deposit['"]/.test(depositSrc), 'submitSeamlessDeposit passes triggerEvent deposit');
ok(/jurisdiction\.data\?\.status\s*!==\s*['"]approved['"]/.test(depositSrc), 'submitSeamlessDeposit fails closed unless jurisdiction status is approved');

console.log(`jurisdiction-gates: ${pass} assertions passed (no network).`);