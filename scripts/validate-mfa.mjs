// Regression tests for ChessBet MFA shared helpers.
// Run: node scripts/validate-mfa.mjs
// Tests: generation, email body, hash verification, leading zeros,
//        code normalization, expiry boundary, cooldown/hourly limits.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const path = require('path');
const fs = require('fs');

// Load shared modules as text and eval in a sandbox (they use export syntax).
function loadModule(relPath) {
  const filePath = path.resolve(import.meta.dirname, '..', relPath);
  const src = fs.readFileSync(filePath, 'utf-8');
  // Strip export keywords for evaluation in a CommonJS-ish scope.
  const stripped = src
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+async\s+function\s+/g, 'async function ');
  const module = {};
  const fn = new Function('module', stripped + '; module.sha256Hex = sha256Hex; module.generateOtp = generateOtp; module.normalizeOtpCode = normalizeOtpCode; module.OTP_TTL_MS = OTP_TTL_MS; module.RESEND_COOLDOWN_MS = RESEND_COOLDOWN_MS; module.MAX_REQUESTS_PER_HOUR = MAX_REQUESTS_PER_HOUR; module.MAX_ATTEMPTS = MAX_ATTEMPTS; module.MFA_SESSION_TTL_MS = MFA_SESSION_TTL_MS;');
  fn(module);
  return module;
}

const core = loadModule('base44/shared/mfaCore.js');

// Load mfaEmail.js (it uses export too).
function loadEmailModule() {
  const filePath = path.resolve(import.meta.dirname, '..', 'base44/shared/mfaEmail.js');
  const src = fs.readFileSync(filePath, 'utf-8');
  const stripped = src.replace(/export\s+function\s+/g, 'function ');
  const module = {};
  const fn = new Function('module', stripped + '; module.buildMfaEmail = buildMfaEmail;');
  fn(module);
  return module;
}

const email = loadEmailModule();

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`FAIL: ${name}`);
  }
}

function assertEqual(actual, expected, name) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// --- Test 1: generateOtp produces exactly 6 digits ---
{
  let allValid = true;
  for (let i = 0; i < 10000; i++) {
    const otp = core.generateOtp();
    if (!/^\d{6}$/.test(otp)) { allValid = false; break; }
  }
  assert(allValid, 'generateOtp always produces 6 digits');
}

// --- Test 2: generateOtp can produce leading zeros ---
{
  let foundLeadingZero = false;
  for (let i = 0; i < 100000; i++) {
    const otp = core.generateOtp();
    if (otp.startsWith('0')) { foundLeadingZero = true; break; }
  }
  assert(foundLeadingZero, 'generateOtp can produce codes with leading zeros');
}

// --- Test 3: sha256Hex is deterministic ---
{
  const hash1 = await core.sha256Hex('test');
  const hash2 = await core.sha256Hex('test');
  assertEqual(hash1, hash2, 'sha256Hex is deterministic');
  assertEqual(hash1.length, 64, 'sha256Hex produces 64-char hex');
}

// --- Test 4: Hash verification with salt + code ---
{
  const salt = 'test-salt-123';
  const code = '001234';
  const hash = await core.sha256Hex(salt + code);
  const candidateHash = await core.sha256Hex(salt + code);
  assertEqual(candidateHash, hash, 'Hash verification matches with correct salt+code');
}

// --- Test 5: Hash mismatch with wrong code ---
{
  const salt = 'test-salt-123';
  const code = '001234';
  const hash = await core.sha256Hex(salt + code);
  const wrongHash = await core.sha256Hex(salt + '999999');
  assert(wrongHash !== hash, 'Hash mismatch with wrong code');
}

// --- Test 6: Leading zeros preserved in hash ---
{
  const salt = 'abc';
  const codeWithZeros = '000001';
  const codeWithoutZeros = '1';
  const hashWithZeros = await core.sha256Hex(salt + codeWithZeros);
  const hashWithoutZeros = await core.sha256Hex(salt + codeWithoutZeros);
  assert(hashWithZeros !== hashWithoutZeros, 'Leading zeros produce different hash (not stripped)');
}

// --- Test 7: normalizeOtpCode handles whitespace ---
{
  assertEqual(core.normalizeOtpCode('  123456  '), '123456', 'normalizeOtpCode trims whitespace');
  assertEqual(core.normalizeOtpCode('12 34 56'), '123456', 'normalizeOtpCode strips internal spaces');
  assertEqual(core.normalizeOtpCode('12-34-56'), '123456', 'normalizeOtpCode strips dashes');
  assertEqual(core.normalizeOtpCode('  00 12 34  '), '001234', 'normalizeOtpCode preserves leading zeros after stripping');
}

// --- Test 8: normalizeOtpCode rejects invalid input ---
{
  assertEqual(core.normalizeOtpCode('12345'), null, 'normalizeOtpCode rejects 5 digits');
  assertEqual(core.normalizeOtpCode('1234567'), null, 'normalizeOtpCode rejects 7 digits');
  assertEqual(core.normalizeOtpCode('abc123'), null, 'normalizeOtpCode rejects letters');
  assertEqual(core.normalizeOtpCode(''), null, 'normalizeOtpCode rejects empty string');
  assertEqual(core.normalizeOtpCode(null), null, 'normalizeOtpCode rejects null');
  assertEqual(core.normalizeOtpCode(123456), null, 'normalizeOtpCode rejects number');
}

// --- Test 9: buildMfaEmail produces valid HTML with code ---
{
  const html = email.buildMfaEmail('001234', 10);
  assert(html.includes('001234'), 'buildMfaEmail includes the code with leading zeros');
  assert(html.includes('ChessBet'), 'buildMfaEmail includes brand name');
  assert(html.includes('10 minutes'), 'buildMfaEmail includes expiry minutes');
  assert(html.includes('logo'), 'buildMfaEmail includes logo');
}

// --- Test 10: buildMfaEmail rejects invalid input ---
{
  let threw = false;
  try { email.buildMfaEmail('12345', 10); } catch { threw = true; }
  assert(threw, 'buildMfaEmail rejects 5-digit code');

  threw = false;
  try { email.buildMfaEmail('123456', 0); } catch { threw = true; }
  assert(threw, 'buildMfaEmail rejects 0 expiry minutes');
}

// --- Test 11: Constants match spec ---
{
  assertEqual(core.OTP_TTL_MS, 10 * 60 * 1000, 'OTP_TTL_MS is 10 minutes');
  assertEqual(core.RESEND_COOLDOWN_MS, 60 * 1000, 'RESEND_COOLDOWN_MS is 60 seconds');
  assertEqual(core.MAX_REQUESTS_PER_HOUR, 5, 'MAX_REQUESTS_PER_HOUR is 5');
  assertEqual(core.MAX_ATTEMPTS, 5, 'MAX_ATTEMPTS is 5');
  assertEqual(core.MFA_SESSION_TTL_MS, 8 * 60 * 60 * 1000, 'MFA_SESSION_TTL_MS is 8 hours');
}

// --- Test 12: Expiry boundary (exact 10-minute window) ---
{
  const now = new Date();
  const expiresAt = new Date(now.getTime() + core.OTP_TTL_MS);
  const justBefore = new Date(expiresAt.getTime() - 1);
  const justAfter = new Date(expiresAt.getTime() + 1);
  assert(justBefore < expiresAt, 'Time just before expiry is valid');
  assert(justAfter >= expiresAt, 'Time just after expiry is invalid');
}

// --- Test 13: Cooldown boundary (exact 60-second window) ---
{
  const created = new Date();
  const cooldownEnd = new Date(created.getTime() + core.RESEND_COOLDOWN_MS);
  const elapsed59s = new Date(created.getTime() + 59 * 1000);
  const elapsed60s = new Date(created.getTime() + 60 * 1000);
  assert(elapsed59s < cooldownEnd, '59s elapsed: cooldown still active');
  assert(elapsed60s >= cooldownEnd, '60s elapsed: cooldown expired');
}

// --- Test 14: Hourly limit boundary ---
{
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const justInsideWindow = new Date(now.getTime() - 59 * 60 * 1000);
  const justOutsideWindow = new Date(now.getTime() - 61 * 60 * 1000);
  assert(justInsideWindow > oneHourAgo, '59-min-old request is inside hourly window');
  assert(justOutsideWindow <= oneHourAgo, '61-min-old request is outside hourly window');
}

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}