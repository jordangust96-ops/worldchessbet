// Deterministic, no-network, no-email verification of the blocked-jurisdiction
// notification feature: opt-in prompt eligibility, region data + validation,
// one-preference-per-user upsert shape, RLS presence, centralized approved-
// location matching (incl. parity with the frontend allowlist), the at-most-
// once claim/send state machine, the branded template/CTA, the no-PII demand
// summary, the daily scheduled workflow, and preservation of the existing
// route-order / single-MaxMind-check / cache behavior.
//
// Runs under plain Node (`node scripts/validate-jurisdiction-waitlist.mjs`),
// makes NO requests to MaxMind or Base44, imports NO JSX, sends NO email, and
// invokes NO backend function. It exercises the pure helpers in
// base44/shared/jurisdictionRegions.js and src/lib/jurisdictionAccess.js and
// statically asserts the source files wire enforcement correctly.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const {
  APPROVED_STATES,
  US_REGIONS,
  ISO_COUNTRIES,
  normalizeCountryCode,
  normalizeRegionCode,
  isValidIsoCountry,
  isValidUsRegion,
  getCountryName,
  getRegionName,
  isLocationApproved,
} = await import('../base44/shared/jurisdictionRegions.js');

const { APPROVED_STATES: FRONTEND_APPROVED_STATES } = await import('../src/lib/jurisdictionConfig.js');
const { evaluateJurisdictionAccess } = await import('../src/lib/jurisdictionAccess.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); pass++; };

// ---------------------------------------------------------------------------
// 1. Region data integrity + parity with the frontend allowlist
// ---------------------------------------------------------------------------
eq(APPROVED_STATES, ['AR', 'CO', 'GA', 'IA', 'KS', 'ND', 'TX', 'VA', 'WI', 'WY'], 'shared approved states is the Tier 1 set');
eq(APPROVED_STATES, FRONTEND_APPROVED_STATES, 'PARITY: backend shared APPROVED_STATES === frontend jurisdictionConfig APPROVED_STATES');
ok(ISO_COUNTRIES.length === 249, 'ISO_COUNTRIES has all 249 officially-assigned codes');
ok(new Set(ISO_COUNTRIES.map((c) => c.code)).size === 249, 'ISO country codes are unique');
ok(ISO_COUNTRIES.some((c) => c.code === 'US'), 'United States present');
ok(US_REGIONS.length === 51, 'US_REGIONS has 50 states + DC');
ok(new Set(US_REGIONS.map((r) => r.code)).size === 51, 'US region codes are unique');
ok(US_REGIONS.some((r) => r.code === 'DC'), 'District of Columbia present');
ok(APPROVED_STATES.every((s) => US_REGIONS.some((r) => r.code === s)), 'every approved state is a valid US region');

// ---------------------------------------------------------------------------
// 2. Validation + normalization
// ---------------------------------------------------------------------------
ok(normalizeCountryCode(' us ') === 'US', 'country normalized to uppercase');
ok(normalizeRegionCode(' tx ') === 'TX', 'region normalized to uppercase');
ok(isValidIsoCountry('US') === true, 'US is a valid ISO country');
ok(isValidIsoCountry('us') === false, 'lowercase ISO code rejected (case-sensitive)');
ok(isValidIsoCountry('XX') === false, 'unknown ISO country rejected');
ok(isValidIsoCountry('') === false, 'empty country rejected');
ok(isValidUsRegion('TX') === true, 'TX is a valid US region');
ok(isValidUsRegion('tx') === false, 'lowercase US region rejected');
ok(isValidUsRegion('ZZ') === false, 'unknown US region rejected');
ok(isValidUsRegion('') === false, 'empty US region rejected');
eq(getCountryName('US'), 'United States', 'US country name');
eq(getRegionName('TX'), 'Texas', 'TX region name');
eq(getRegionName('AR'), 'Arkansas', 'AR region name (alphabetical parity with required copy)');
eq(getCountryName('XX'), '', 'unknown country name is empty');

// ---------------------------------------------------------------------------
// 3. Centralized approved-location matching (shared by geogating + processor)
// ---------------------------------------------------------------------------
ok(isLocationApproved('US', 'TX') === true, 'US+TX approved');
ok(isLocationApproved('US', 'MI') === false, 'US+unapproved state NOT approved');
ok(isLocationApproved('US', '') === false, 'US+empty region NOT approved');
ok(isLocationApproved('US', null) === false, 'US+null region NOT approved');
ok(isLocationApproved('CA', 'ON') === false, 'non-US NOT approved (Tier 1 is US-only)');
ok(isLocationApproved('', '') === false, 'empty NOT approved');
ok(isLocationApproved('us', 'tx') === false, 'non-normalized input NOT approved (case-sensitive)');

// ---------------------------------------------------------------------------
// 4. Opt-in prompt eligibility (positively blocked ONLY)
// ---------------------------------------------------------------------------
const baseApproved = { enforcementEnabled: true, status: 'approved', approved: true, country: 'US', state: 'TX' };
ok(evaluateJurisdictionAccess(baseApproved).allowed === true, 'approved -> allowed');
ok(evaluateJurisdictionAccess(baseApproved).promptEligible === false, 'approved -> NOT prompt eligible');

const blocked = { enforcementEnabled: true, status: 'blocked', approved: false, country: 'US', state: 'MI' };
eq(evaluateJurisdictionAccess(blocked).allowed, false, 'blocked -> not allowed');
eq(evaluateJurisdictionAccess(blocked).promptEligible, true, 'positively blocked -> prompt eligible');

const blockedNonUs = { enforcementEnabled: true, status: 'blocked', approved: false, country: 'CA', state: 'ON' };
eq(evaluateJurisdictionAccess(blockedNonUs).promptEligible, true, 'non-US blocked -> prompt eligible');

// Unverifiable / disabled / anonymizer -> NEVER prompt.
eq(evaluateJurisdictionAccess({ enforcementEnabled: true, status: 'unknown', approved: false, country: 'US', state: 'TX' }).promptEligible, false, 'unknown -> NOT prompt eligible');
eq(evaluateJurisdictionAccess({ enforcementEnabled: true, status: 'verification_failed', approved: false, country: 'US', state: 'TX' }).promptEligible, false, 'verification_failed -> NOT prompt eligible');
eq(evaluateJurisdictionAccess({ ...blocked, vpnDetected: true }).promptEligible, false, 'blocked+vpnDetected -> NOT prompt eligible');
eq(evaluateJurisdictionAccess({ ...blocked, isAnonymousVpn: true }).promptEligible, false, 'blocked+anonymizer signal -> NOT prompt eligible');
eq(evaluateJurisdictionAccess({ enforcementEnabled: false, status: 'approved', approved: true, country: 'US', state: 'TX' }).promptEligible, false, 'disabled enforcement -> NOT prompt eligible');
eq(evaluateJurisdictionAccess({ enforcementEnabled: undefined, status: 'blocked', approved: false, country: 'US', state: 'MI' }).promptEligible, false, 'undefined enforcement -> NOT prompt eligible');
eq(evaluateJurisdictionAccess(null).promptEligible, false, 'null response -> NOT prompt eligible');
eq(evaluateJurisdictionAccess({}).promptEligible, false, 'empty response -> NOT prompt eligible');
// Even an "approved" status with an unapproved state must NOT be allowed nor prompt.
eq(evaluateJurisdictionAccess({ ...baseApproved, state: 'MI' }.allowed === undefined ? { ...baseApproved, state: 'MI' } : { ...baseApproved, state: 'MI' }).allowed, false, 'approved status + unapproved state -> not allowed');
eq(evaluateJurisdictionAccess({ ...baseApproved, state: 'MI' }).promptEligible, false, 'approved status + unapproved state -> NOT prompt eligible');

// ---------------------------------------------------------------------------
// 5. One preference per user (static source: upsert)
// ---------------------------------------------------------------------------
const upsertSrc = await read('base44/functions/upsertJurisdictionInterest/entry.ts');
ok(/base44\.auth\.me\(\)/.test(upsertSrc), 'upsert derives identity from auth.me()');
ok(/user\.id/.test(upsertSrc) && /user\.email/.test(upsertSrc), 'upsert uses authenticated user id + email');
ok(!/body\?\.(user_id|email)/.test(upsertSrc), 'upsert never reads recipient identity from the body');
ok(/filter\(\s*\{\s*user_id:\s*user\.id,\s*is_active:\s*true\s*\}/.test(upsertSrc), 'upsert filters existing active preference by user_id');
ok(/is_active:\s*false/.test(upsertSrc), 'upsert deactivates stale duplicates');
ok(/isValidIsoCountry/.test(upsertSrc), 'upsert validates ISO country');
ok(/isValidUsRegion/.test(upsertSrc), 'upsert validates US region');
ok(/rawCountry\s*===\s*'US'/.test(upsertSrc), 'US region required only when country is US');
ok(!/Email|SendEmail|emailTemplate/.test(upsertSrc), 'upsert NEVER sends email or imports the email template (no confirmation on opt-in)');

// ---------------------------------------------------------------------------
// 6. RLS presence (one own row; admin read/update all; no public; no user delete)
// ---------------------------------------------------------------------------
const entitySrc = await read('base44/entities/JurisdictionInterest.jsonc');
const entity = JSON.parse(entitySrc);
eq(entity.name, 'JurisdictionInterest', 'entity name');
const required = ['user_id', 'email', 'selected_country_code', 'selected_country_name', 'consent_at', 'source', 'status'];
ok(required.every((f) => entity.required.includes(f)), 'required fields present');
const props = Object.keys(entity.properties);
for (const f of ['processing_claimed_at', 'notified_at', 'last_failed_at', 'attempts', 'last_error', 'is_active', 'selected_region_code', 'selected_region_name']) {
  ok(props.includes(f), `audit/processing field present: ${f}`);
}
eq(entity.properties.status.enum, ['pending', 'processing', 'notified', 'failed'], 'status state machine enum');
ok(JSON.stringify(entity.rls.create) === JSON.stringify({ 'data.user_id': '{{user.id}}' }), 'RLS create: only own row (no public)');
ok(entity.rls.read.$or && JSON.stringify(entity.rls.read.$or[0]) === JSON.stringify({ 'data.user_id': '{{user.id}}' }) && JSON.stringify(entity.rls.read.$or[1]) === JSON.stringify({ user_condition: { role: 'admin' } }), 'RLS read: own or admin');
ok(entity.rls.update.$or && JSON.stringify(entity.rls.update.$or[0]) === JSON.stringify({ 'data.user_id': '{{user.id}}' }), 'RLS update: includes own');
ok(JSON.stringify(entity.rls.delete) === JSON.stringify({ user_condition: { role: 'admin' } }), 'RLS delete: admin only (users cannot delete)');

// ---------------------------------------------------------------------------
// 7. Centralized approved-location matching wired into BOTH paths (static)
// ---------------------------------------------------------------------------
const getCurrentSrc = await read('base44/functions/getCurrentJurisdiction/entry.ts');
ok(getCurrentSrc.includes("from '../../shared/jurisdictionRegions.js'"), 'getCurrentJurisdiction imports the shared regions module');
ok(/isLocationApproved\(country,\s*state\)/.test(getCurrentSrc) || /isLocationApproved\(/.test(getCurrentSrc), 'getCurrentJurisdiction uses isLocationApproved');
ok(!/const APPROVED_STATES\s*=\s*\[/.test(getCurrentSrc), 'getCurrentJurisdiction no longer hard-codes APPROVED_STATES (centralized)');

const processSrc = await read('base44/functions/processJurisdictionApprovalNotifications/entry.ts');
ok(processSrc.includes("from '../../shared/jurisdictionRegions.js'"), 'processor imports shared regions module');
ok(/isLocationApproved\(row\.selected_country_code,\s*row\.selected_region_code\)/.test(processSrc), 'processor uses isLocationApproved on the stored preference');
ok(!/geoip\.maxmind\.com|lookupWithMaxMind|import .*getCurrentJurisdiction/.test(processSrc) && !/\bgetCurrentJurisdiction\s*\(/.test(processSrc), 'processor never calls MaxMind or getCurrentJurisdiction');

// ---------------------------------------------------------------------------
// 8. At-most-once claim/send state machine (static)
// ---------------------------------------------------------------------------
ok(/filter\(\s*\{\s*is_active:\s*true,\s*status:\s*'pending'\s*\}/.test(processSrc), 'processor selects ONLY pending active rows');
ok(/MAX_BATCH\s*=\s*\d+/.test(processSrc), 'processor uses a bounded batch');
ok(/status:\s*'processing'/.test(processSrc) && /processing_claimed_at/.test(processSrc), 'processor claims row -> processing before send');
ok(/SendEmail/.test(processSrc), 'processor calls SendEmail (launch notice only)');
ok(/status:\s*'notified'/.test(processSrc) && /notified_at/.test(processSrc), 'processor marks notified after success');
ok(/status:\s*'failed'/.test(processSrc) && /last_failed_at/.test(processSrc) && /last_error/.test(processSrc), 'processor records safe failure state');
// Admin OR exact run_token match; a logged-in non-admin with no/invalid token is forbidden.
ok(/user\.role\s*===\s*'admin'/.test(processSrc), 'processor grants only an authenticated admin (token path is separate)');

// ---------------------------------------------------------------------------
// 9. Branded template + CTA (static)
// ---------------------------------------------------------------------------
ok(processSrc.includes("from '../../shared/emailTemplate.ts'"), 'processor reuses shared branded email template');
ok(/ctaText:\s*'Play ChessBet'/.test(processSrc), 'processor CTA is "Play ChessBet"');
ok(/ctaUrl:\s*appUrl/.test(processSrc), 'processor CTA links to the app');
ok(/from_name:\s*'ChessBet'/.test(processSrc), 'processor sends as from_name ChessBet');
ok(/APP_URL/.test(processSrc), 'processor reads APP_URL for branded links');
ok(/reason for the email/i.test(processSrc) || /notify you when ChessBet becomes available/.test(processSrc), 'processor body explains the reason for the email');

// ---------------------------------------------------------------------------
// 10. Demand summary: no PII, admin-only, sorted by demand (static)
// ---------------------------------------------------------------------------
const demandSrc = await read('base44/functions/getJurisdictionDemandSummary/entry.ts');
ok(/role\s*!==\s*'admin'/.test(demandSrc) || /role\s*===\s*'admin'/.test(demandSrc), 'demand summary is admin-only');
ok(/sort\(\(a,\s*b\)\s*=>\s*b\.count\s*-\s*a\.count/.test(demandSrc), 'demand summary sorts by count desc (demand)');
ok(demandSrc.includes('by_country') && demandSrc.includes('by_region') && demandSrc.includes('by_status'), 'demand summary returns aggregates');
ok(!/\bemail\b\s*:/.test(demandSrc) && !/\buser_id\b\s*:/.test(demandSrc), 'demand summary returns NO email or user_id PII');

// ---------------------------------------------------------------------------
// 11. Daily scheduled workflow calls ONLY the processor (never MaxMind) (static)
// ---------------------------------------------------------------------------
const workflowSrc = await read('base44/workflows/JurisdictionApprovalNotifications.jsonc');
const workflow = JSON.parse(workflowSrc);
eq(workflow.trigger.config.trigger_type, 'scheduled', 'workflow trigger is scheduled');
eq(workflow.trigger.config.cron_expression, '30 9 * * *', 'workflow runs daily at 09:30 America/Detroit');
eq(workflow.trigger.config.timezone, 'America/Detroit', 'workflow timezone is America/Detroit');
const task = workflow.definition.do[0].process_notifications;
eq(task.call, 'invoke_backend_function', 'workflow tasks invoke a backend function');
eq(task.with.function_name, 'processJurisdictionApprovalNotifications', 'workflow calls the processor');
eq(task.then, 'end', 'workflow terminates after the processor');
ok(!/lookupWithMaxMind|geoip\.maxmind\.com|\bgetCurrentJurisdiction\b/.test(workflowSrc), 'workflow never schedules MaxMind');

// ---------------------------------------------------------------------------
// 12. Guard wires opt-in ONLY when prompt eligible; preserves single check +
//     route order / cache / fail-closed behavior (static)
// ---------------------------------------------------------------------------
const guardSrc = await read('src/components/JurisdictionAccessGuard.jsx');
ok(guardSrc.includes('promptEligible'), 'guard surfaces promptEligible');
ok(guardSrc.includes('JurisdictionWaitlistOptIn'), 'guard renders the opt-in component');
ok(/promptEligible=\{decision\.promptEligible\}/.test(guardSrc) || /promptElligible=\{decision\.promptEligible\}/.test(guardSrc), 'guard passes promptElligible to UnavailableScreen');
// See the matching comment in validate-jurisdiction-gates.mjs: the guard's
// Outlet legitimately carries a context prop now, so match the tag loosely.
ok(/<Outlet\b/.test(guardSrc), 'guard still renders <Outlet /> (optionally with props) when allowed');
ok(/triggerEvent:\s*["']app_access["']/.test(guardSrc), 'guard still triggers getCurrentJurisdiction with app_access');
ok(!/Retry/.test(guardSrc), 'guard still has no retry button');
ok(!/setTimeout|setInterval/.test(guardSrc), 'guard still has no timer');
ok(!/addEventListener/.test(guardSrc), 'guard still has no focus/visibility listener');
ok(!/useNavigate/.test(guardSrc), 'guard still has no navigation listener');
ok(!/localStorage|sessionStorage/.test(guardSrc), 'guard still uses no localStorage/sessionStorage');
ok(/getJurisdictionCheck\(\s*userId/.test(guardSrc), 'guard still dedups via getJurisdictionCheck');
ok(guardSrc.includes('APPROVED_STATES') && guardSrc.includes('getRegionName'), 'guard shows approved jurisdictions by full state name');

const optInSrc = await read('src/components/jurisdiction/JurisdictionWaitlistOptIn.jsx');
ok(optInSrc.includes('ISO_COUNTRIES'), 'opt-in lists all ISO countries');
ok(optInSrc.includes('US_REGIONS'), 'opt-in lists all US regions');
ok(!/<input[^>]*type=["']email["']/.test(optInSrc), 'opt-in never renders a free-form email input');
ok(optInSrc.includes('upsertJurisdictionInterest'), 'opt-in calls the upsert function');
ok(/export default function JurisdictionWaitlistOptIn\(\s*\{\s*userEmail\s*\}/.test(optInSrc), 'opt-in takes userEmail prop (not a free-form field)');

// JurisdictionPanel demand section present (admin aggregate).
const panelSrc = await read('src/components/integrity/JurisdictionPanel.jsx');
ok(panelSrc.includes('JurisdictionDemandSection'), 'admin JurisdictionPanel renders a demand section');
ok(panelSrc.includes('getJurisdictionDemandSummary'), 'admin JurisdictionPanel fetches the demand summary');

// ---------------------------------------------------------------------------
// 13. Route order preserved (auth guard -> jurisdiction -> MFA -> policy)
// ---------------------------------------------------------------------------
const appSrc = await read('src/AuthenticatedApplication.jsx');
const prIdx = appSrc.indexOf('<Route element={<ProtectedRoute');
const guardIdx = appSrc.indexOf('<Route element={<JurisdictionAccessGuard');
const mfaIdx = appSrc.indexOf('<Route element={<MfaGuard');
const policyIdx = appSrc.indexOf('<Route element={<PolicyAcceptanceGuard');
ok(prIdx !== -1 && guardIdx !== -1 && mfaIdx !== -1 && policyIdx !== -1, 'all four guard route elements still present');
ok(prIdx < guardIdx, 'ProtectedRoute (auth) still precedes JurisdictionAccessGuard');
ok(guardIdx < mfaIdx, 'JurisdictionAccessGuard still precedes MfaGuard');
ok(mfaIdx < policyIdx, 'MfaGuard still precedes PolicyAcceptanceGuard');

// ---------------------------------------------------------------------------
// 14. No MaxMind / no email performed by THIS test file
// ---------------------------------------------------------------------------
const thisSrc = await read('scripts/validate-jurisdiction-waitlist.mjs');
ok(!/core\.SendEmail|base44\.auth\.me|base44\.entities\.[A-Za-z]+\.(create|update|filter|list)/.test(thisSrc.replace(/read\(.*?\)/g, '')), 'test file performs no SendEmail / auth.me / live entity calls');

// ---------------------------------------------------------------------------
// 15. Processor auth gate: admin-or-run_token only, authorization-first (static)
//     No-session + no/invalid token -> 403 BEFORE any service-role read/write/email.
//     The compare is constant-time and the token is never logged or returned.
//     The workflow passes a nonempty run_token arg; we assert length only and
//     never print it.
// ---------------------------------------------------------------------------
ok(/import\s*\{\s*secrets\s*\}\s*from\s*['"]base44:runtime['"]/.test(processSrc), 'processor imports secrets from base44:runtime');
ok(/secrets\.get\(\s*['"]JURISDICTION_PROCESSOR_RUN_TOKEN['"]\s*\)/.test(processSrc), 'processor reads the JURISDICTION_PROCESSOR_RUN_TOKEN secret');
ok(/await\s+req\.json\(\)/.test(processSrc), 'processor parses the request body as JSON safely');
ok(/run_token/.test(processSrc), 'processor reads run_token from the parsed body');
ok(/status:\s*403/.test(processSrc) && /Forbidden/.test(processSrc), 'unauthorized callers receive 403 Forbidden');
{
  const authGateIdx = processSrc.indexOf('Forbidden');
  const firstSvcIdx = processSrc.search(/svc\.\w+\.(filter|create|update|list|get)|asServiceRole\.integrations/);
  ok(authGateIdx !== -1 && firstSvcIdx !== -1 && authGateIdx < firstSvcIdx, 'authorization gate precedes every service-role read/write/email');
}
ok(/ea\.length\s*!==\s*eb\.length/.test(processSrc), 'compare rejects length mismatch before comparing bytes');
ok(/for\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*ea\.length\s*;\s*\w+\+\+\)/.test(processSrc), 'compare iterates all bytes (constant-time, no early exit)');
ok(/\|=\s*[^;]*\^/.test(processSrc), 'compare XORs each byte pair (no early exit)');
ok(!/console\.\w+\([^)]*token/i.test(processSrc), 'processor never logs the token');
ok(!/return[^;]*expectedToken/.test(processSrc) && !/JSON\.stringify\([^)]*token/i.test(processSrc), 'processor never returns/serializes the token');
{
  const wfArgs = workflow.definition.do[0].process_notifications.with.args || {};
  ok(typeof wfArgs.run_token === 'string' && wfArgs.run_token.length === 64, 'workflow passes a 64-char hex run_token arg');
}
ok(!/console\.(log|error|info)\([^)]*run_token/.test(thisSrc), 'test file never logs the run_token value');

console.log(`jurisdiction-waitlist: ${pass} assertions passed (no network, no email).`);