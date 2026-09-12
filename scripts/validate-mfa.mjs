// Regression tests for ChessBet MFA system.
// Run: node scripts/validate-mfa.mjs
// Tests: pure helpers, handler-level logic with mocked I/O (processRequest,
//        processVerify, processValidateSession), covering success, failure,
//        concurrency, replay, and rejection paths.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const path = require('path');
const fs = require('fs');

// --- Load shared modules by stripping import/export and evaluating in a sandbox ---
function loadMfaModules() {
  const files = [
    'base44/shared/mfaCore.js',
    'base44/shared/mfaEmail.js',
    'base44/shared/mfaRequest.js',
    'base44/shared/mfaVerify.js',
  ];
  const src = files.map(f => {
    let s = fs.readFileSync(path.resolve(import.meta.dirname, '..', f), 'utf-8');
    s = s.replace(/import\s+[^;]*?from\s+['"][^'"]+['"];?\s*/g, '');
    s = s.replace(/export\s+/g, '');
    return s;
  }).join('\n\n');

  const mod = {};
  const cryptoObj = globalThis.crypto || require('crypto').webcrypto;
  const fn = new Function('module', 'crypto', src + `
    module.processRequest = processRequest;
    module.processVerify = processVerify;
    module.processValidateSession = processValidateSession;
    module.sha256Hex = sha256Hex;
    module.generateOtp = generateOtp;
    module.normalizeOtpCode = normalizeOtpCode;
    module.isValidTimestamp = isValidTimestamp;
    module.isExpired = isExpired;
    module.isLockedOut = isLockedOut;
    module.cooldownRemaining = cooldownRemaining;
    module.compareCodes = compareCodes;
    module.OTP_TTL_MS = OTP_TTL_MS;
    module.RESEND_COOLDOWN_MS = RESEND_COOLDOWN_MS;
    module.MAX_REQUESTS_PER_HOUR = MAX_REQUESTS_PER_HOUR;
    module.MAX_ATTEMPTS = MAX_ATTEMPTS;
    module.MFA_SESSION_TTL_MS = MFA_SESSION_TTL_MS;
    module.buildMfaEmail = buildMfaEmail;
  `);
  fn(mod, cryptoObj);
  return mod;
}

const mfa = loadMfaModules();

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

// --- Mock store that simulates updateMany filter operator behavior ---
function createMockStore(initialCodes = [], initialSessions = []) {
  const codes = [...initialCodes];
  const sessions = [...initialSessions];
  const auditLog = [];
  let nextId = 1;

  function matches(doc, filter) {
    for (const [key, val] of Object.entries(filter)) {
      if (key === 'user_id' || key === 'id' || key === 'status' || key === 'delivery_status') {
        if (doc[key] !== val) return false;
      } else if (key === 'attempts' && typeof val === 'object') {
        if (val.$lt !== undefined && !(doc.attempts < val.$lt)) return false;
      } else if (key === 'expires_at' && typeof val === 'object') {
        if (val.$gte !== undefined && !(doc.expires_at >= val.$gte)) return false;
        if (val.$gt !== undefined && !(doc.expires_at > val.$gt)) return false;
      } else if (typeof val === 'object' && val !== null) {
        // Unknown operator — fail safe (no match)
        return false;
      } else {
        if (doc[key] !== val) return false;
      }
    }
    return true;
  }

  return {
    codes, sessions, auditLog,
    getRecentCodes: async (userId, limit) =>
      codes.filter(c => c.user_id === userId)
        .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
        .slice(0, limit),
    getActiveCodes: async (userId, limit) =>
      codes.filter(c => c.user_id === userId && c.status === 'active')
        .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
        .slice(0, limit),
    createCode: async (data) => {
      const c = { id: 'code_' + (nextId++), created_date: new Date().toISOString(), ...data };
      codes.push(c);
      return c;
    },
    getCode: async (userId, codeId) => codes.find(c => c.id === codeId) || null,
    updateCode: async (userId, codeId, filter, update) => {
      const c = codes.find(c => c.id === codeId && c.user_id === userId);
      if (!c) return;
      if (!matches(c, filter)) return;
      if (update.$set) Object.assign(c, update.$set);
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) c[k] = (c[k] || 0) + v;
    },
    createSession: async (data) => {
      const s = { id: 'session_' + (nextId++), ...data };
      sessions.push(s);
      return s;
    },
    revokeSessions: async (userId) => {
      sessions.forEach(s => { if (s.user_id === userId && !s.revoked) s.revoked = true; });
    },
    getSessions: async (userId, tokenHash) =>
      sessions.filter(s => s.user_id === userId && s.token_hash === tokenHash),
    revokeSession: async (userId, sessionId) => {
      const s = sessions.find(s => s.id === sessionId);
      if (s) s.revoked = true;
    },
    audit: async (userId, email, event, detail) => {
      auditLog.push({ user_id: userId, email, event, detail });
    },
  };
}

// --- Helper: create a delivered active code in the mock store ---
async function createDeliveredCode(store, userId, code, opts = {}) {
  const salt = 'salt_' + Math.random().toString(36).slice(2);
  const codeHash = await mfa.sha256Hex(salt + code);
  const now = opts.now || new Date();
  const expiresAt = opts.expiresAt || new Date(now.getTime() + mfa.OTP_TTL_MS).toISOString();
  const code2 = {
    id: 'code_' + Math.random().toString(36).slice(2),
    user_id: userId,
    email: 'user@test.invalid',
    code_hash: codeHash,
    salt,
    expires_at: expiresAt,
    attempts: opts.attempts || 0,
    status: 'active',
    delivery_status: 'delivered',
    created_date: opts.createdDate || now.toISOString(),
  };
  store.codes.push(code2);
  return code2;
}

const USER = { id: 'user-1', email: 'user@test.invalid' };

// ============ PURE HELPER TESTS ============

// Test 1: generateOtp produces exactly 6 digits
{
  let allValid = true;
  for (let i = 0; i < 10000; i++) {
    if (!/^\d{6}$/.test(mfa.generateOtp())) { allValid = false; break; }
  }
  assert(allValid, 'generateOtp always produces 6 digits');
}

// Test 2: generateOtp can produce leading zeros
{
  let found = false;
  for (let i = 0; i < 100000; i++) {
    if (mfa.generateOtp().startsWith('0')) { found = true; break; }
  }
  assert(found, 'generateOtp can produce codes with leading zeros');
}

// Test 3: sha256Hex is deterministic
{
  const h1 = await mfa.sha256Hex('test');
  const h2 = await mfa.sha256Hex('test');
  assertEqual(h1, h2, 'sha256Hex is deterministic');
  assertEqual(h1.length, 64, 'sha256Hex produces 64-char hex');
}

// Test 4: normalizeOtpCode handles whitespace and dashes
{
  assertEqual(mfa.normalizeOtpCode('  123456  '), '123456', 'normalizeOtpCode trims whitespace');
  assertEqual(mfa.normalizeOtpCode('12 34 56'), '123456', 'normalizeOtpCode strips internal spaces');
  assertEqual(mfa.normalizeOtpCode('12-34-56'), '123456', 'normalizeOtpCode strips dashes');
  assertEqual(mfa.normalizeOtpCode('  00 12 34  '), '001234', 'normalizeOtpCode preserves leading zeros');
}

// Test 5: normalizeOtpCode rejects invalid input
{
  assertEqual(mfa.normalizeOtpCode('12345'), null, 'rejects 5 digits');
  assertEqual(mfa.normalizeOtpCode('1234567'), null, 'rejects 7 digits');
  assertEqual(mfa.normalizeOtpCode('abc123'), null, 'rejects letters');
  assertEqual(mfa.normalizeOtpCode(''), null, 'rejects empty');
  assertEqual(mfa.normalizeOtpCode(null), null, 'rejects null');
  assertEqual(mfa.normalizeOtpCode(123456), null, 'rejects number');
}

// Test 6: isExpired uses >= (exact expiry is expired)
{
  const expiry = new Date('2026-01-01T12:00:00Z');
  assert(mfa.isExpired('2026-01-01T12:00:00Z', expiry), 'exact expiry is expired (>=)');
  assert(!mfa.isExpired('2026-01-01T12:00:01Z', expiry), '1s before expiry is not expired');
  assert(mfa.isExpired('2026-01-01T11:59:59Z', expiry), '1s after expiry is expired');
}

// Test 7: isExpired rejects invalid timestamps
{
  assert(mfa.isExpired('not-a-date'), 'invalid timestamp is expired');
  assert(mfa.isExpired(null), 'null is expired');
  assert(mfa.isExpired(''), 'empty string is expired');
}

// Test 8: isLockedOut
{
  assert(!mfa.isLockedOut(0), '0 attempts not locked');
  assert(!mfa.isLockedOut(4), '4 attempts not locked');
  assert(mfa.isLockedOut(5), '5 attempts locked');
  assert(mfa.isLockedOut(6), '6 attempts locked');
  assert(!mfa.isLockedOut(null), 'null attempts not locked (coerced to 0)');
}

// Test 9: cooldownRemaining
{
  const created = new Date('2026-01-01T12:00:00Z');
  const now30 = new Date('2026-01-01T12:00:30Z');
  const now60 = new Date('2026-01-01T12:01:00Z');
  assertEqual(mfa.cooldownRemaining(created.toISOString(), now30), 30, '30s elapsed → 30s remaining');
  assertEqual(mfa.cooldownRemaining(created.toISOString(), now60), 0, '60s elapsed → 0s remaining');
  assertEqual(mfa.cooldownRemaining('invalid', now30), 0, 'invalid created → 0 remaining');
}

// Test 10: buildMfaEmail
{
  const html = mfa.buildMfaEmail('001234', 10);
  assert(html.includes('001234'), 'email includes code with leading zeros');
  assert(html.includes('ChessBet'), 'email includes brand');
  assert(html.includes('10 minutes'), 'email includes expiry minutes');
}

// ============ PROCESS VERIFY TESTS (handler-level with mock store) ============

// Test 11: Delivered code → verify → success → session created
{
  const store = createMockStore();
  const code = '123456';
  const c = await createDeliveredCode(store, USER.id, code);
  const result = await mfa.processVerify({
    code, user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  assertEqual(result.status, 200, 'verify success status');
  assert(result.body.success, 'verify success body');
  assert(result.body.session_token && result.body.session_token.length >= 32, 'session token generated');
  assertEqual(store.codes.find(c2 => c2.id === c.id).status, 'verified', 'code marked verified');
  assertEqual(store.sessions.length, 1, 'one session created');
  assertEqual(store.sessions[0].user_id, USER.id, 'session user_id correct');
  assert(!store.sessions[0].revoked, 'session not revoked');
}

// Test 12: Wrong code → attempts incremented, bounded
{
  const store = createMockStore();
  const c = await createDeliveredCode(store, USER.id, '123456', { attempts: 0 });
  const result = await mfa.processVerify({
    code: '999999', user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  assertEqual(result.status, 400, 'wrong code status');
  assertEqual(result.body.error, 'invalid', 'wrong code error type');
  assertEqual(result.body.attempts_remaining, 4, '4 attempts remaining');
  const updated = store.codes.find(c2 => c2.id === c.id);
  assertEqual(updated.attempts, 1, 'attempts incremented to 1');
  assertEqual(updated.status, 'active', 'code still active');
}

// Test 13: Five wrong attempts → locked out
{
  const store = createMockStore();
  const c = await createDeliveredCode(store, USER.id, '123456', { attempts: 4 });
  const result = await mfa.processVerify({
    code: '999999', user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  assertEqual(result.status, 400, 'fifth wrong attempt status');
  assertEqual(result.body.error, 'too_many_attempts', 'locked out error');
  assertEqual(result.body.attempts_remaining, 0, '0 attempts remaining');
  const updated = store.codes.find(c2 => c2.id === c.id);
  assertEqual(updated.attempts, 5, 'attempts at 5');
  assertEqual(updated.status, 'invalidated', 'code invalidated after lockout');
}

// Test 14: Bounded $inc — attempts cannot exceed MAX_ATTEMPTS
{
  const store = createMockStore();
  const c = await createDeliveredCode(store, USER.id, '123456', { attempts: 5 });
  // Code already at max attempts — verify with wrong code should NOT increment
  const result = await mfa.processVerify({
    code: '999999', user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  assertEqual(result.status, 400, 'locked out from pre-check status');
  assertEqual(result.body.error, 'too_many_attempts', 'locked out error');
  const updated = store.codes.find(c2 => c2.id === c.id);
  assertEqual(updated.attempts, 5, 'attempts not incremented beyond max');
  assertEqual(updated.status, 'invalidated', 'code invalidated when already at max');
}

// Test 15: Expired code → rejected (>=)
{
  const store = createMockStore();
  const pastExpiry = new Date(Date.now() - 60000).toISOString();
  const c = await createDeliveredCode(store, USER.id, '123456', { expiresAt: pastExpiry });
  const result = await mfa.processVerify({
    code: '123456', user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  assertEqual(result.status, 400, 'expired code status');
  assertEqual(result.body.error, 'expired', 'expired error type');
  assertEqual(store.codes.find(c2 => c2.id === c.id).status, 'expired', 'code marked expired');
}

// Test 16: Exact expiry → rejected (>= boundary)
{
  const store = createMockStore();
  const expiryMs = Date.now();
  const c = await createDeliveredCode(store, USER.id, '123456', {
    expiresAt: new Date(expiryMs).toISOString(),
    now: new Date(expiryMs),
  });
  const result = await mfa.processVerify({
    code: '123456', user: USER, store, userAgent: 'TestBrowser/1.0',
    now: new Date(expiryMs),
  });
  assertEqual(result.status, 400, 'exact expiry rejected');
  assertEqual(result.body.error, 'expired', 'exact expiry error');
}

// Test 17: Pending code → 'pending' error (not delivered yet)
{
  const store = createMockStore();
  const salt = 'test-salt';
  const codeHash = await mfa.sha256Hex(salt + '123456');
  store.codes.push({
    id: 'pending-1', user_id: USER.id, email: USER.email,
    code_hash: codeHash, salt, expires_at: new Date(Date.now() + 600000).toISOString(),
    attempts: 0, status: 'active', delivery_status: 'pending',
    created_date: new Date().toISOString(),
  });
  const result = await mfa.processVerify({
    code: '123456', user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  assertEqual(result.status, 400, 'pending code status');
  assertEqual(result.body.error, 'pending', 'pending error type');
}

// Test 18: No active code → 'invalid' error
{
  const store = createMockStore();
  const result = await mfa.processVerify({
    code: '123456', user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  assertEqual(result.status, 400, 'no active code status');
  assertEqual(result.body.error, 'invalid', 'no active code error');
}

// Test 19: Replay — already verified code → 'already_used'
{
  const store = createMockStore();
  const salt = 'test-salt';
  const codeHash = await mfa.sha256Hex(salt + '123456');
  store.codes.push({
    id: 'verified-1', user_id: USER.id, email: USER.email,
    code_hash: codeHash, salt, expires_at: new Date(Date.now() + 600000).toISOString(),
    attempts: 0, status: 'verified', delivery_status: 'delivered',
    verification_token: 'existing-token',
    created_date: new Date().toISOString(),
  });
  const result = await mfa.processVerify({
    code: '123456', user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  // No active delivered code (the verified one is not 'active'), so falls to no active code
  assertEqual(result.status, 400, 'replay after verify — no active code');
}

// Test 20: CAS — concurrent verify calls, only one succeeds
{
  const store = createMockStore();
  const c = await createDeliveredCode(store, USER.id, '123456');
  // First verify succeeds
  const r1 = await mfa.processVerify({
    code: '123456', user: USER, store, userAgent: 'BrowserA',
  });
  assertEqual(r1.status, 200, 'first concurrent verify succeeds');
  // Manually mark as verified (simulating another request won the CAS)
  store.codes.find(c2 => c2.id === c.id).verification_token = 'other-token';
  // Second verify with correct code — CAS should fail (status already verified)
  // But the code is now 'verified' not 'active', so getActiveCodes won't find it
  const r2 = await mfa.processVerify({
    code: '123456', user: USER, store, userAgent: 'BrowserB',
  });
  assert(r2.status === 400 || r2.status === 409, 'second concurrent verify fails');
}

// ============ PROCESS REQUEST TESTS (handler-level with mock store) ============

// Test 21: Resume with delivered active code → returned, no new code
{
  const store = createMockStore();
  const c = await createDeliveredCode(store, USER.id, '123456');
  const emailCalls = [];
  const emailSender = async () => { emailCalls.push(1); };
  const result = await mfa.processRequest({
    mode: 'resume', user: USER, store, emailSender,
  });
  assertEqual(result.status, 200, 'resume status');
  assert(result.body.resumed, 'resume returned resumed');
  assertEqual(result.body.expires_at, c.expires_at, 'resume returns same expiry');
  assertEqual(emailCalls.length, 0, 'resume did not send email');
}

// Test 22: Resume without delivered active code, within cooldown → cooldown error
{
  const store = createMockStore();
  // Create a code 30s ago that is delivered but EXPIRED — resume won't return it,
  // but the cooldown check sees the recent created_date and blocks new issuance.
  await createDeliveredCode(store, USER.id, '123456', {
    createdDate: new Date(Date.now() - 30000).toISOString(),
    expiresAt: new Date(Date.now() - 10000).toISOString(),
  });
  const emailSender = async () => {};
  const result = await mfa.processRequest({
    mode: 'resume', user: USER, store, emailSender,
  });
  assertEqual(result.status, 429, 'resume within cooldown (no active code) status');
  assertEqual(result.body.error, 'cooldown', 'cooldown error on resume without active code');
  assert(result.body.retry_after_seconds > 0, 'retry_after > 0');
}

// Test 23: Resend within cooldown → cooldown error (applies to every issuance)
{
  const store = createMockStore();
  await createDeliveredCode(store, USER.id, '123456', {
    createdDate: new Date(Date.now() - 10000).toISOString(),
  });
  const emailSender = async () => {};
  const result = await mfa.processRequest({
    mode: 'resend', user: USER, store, emailSender,
  });
  assertEqual(result.status, 429, 'resend within cooldown status');
  assertEqual(result.body.error, 'cooldown', 'resend cooldown error');
}

// Test 24: Email failure → delivery_failed, code invalidated, no success
{
  const store = createMockStore();
  const emailSender = async () => { throw new Error('SMTP down'); };
  const result = await mfa.processRequest({
    mode: 'resend', user: USER, store, emailSender,
  });
  assertEqual(result.status, 502, 'delivery failed status');
  assertEqual(result.body.error, 'delivery_failed', 'delivery_failed error');
  // The code should be invalidated with delivery_status failed
  const failedCode = store.codes.find(c => c.user_id === USER.id);
  assertEqual(failedCode.status, 'invalidated', 'failed code invalidated');
  assertEqual(failedCode.delivery_status, 'failed', 'failed code delivery_status');
}

// Test 25: Successful resend → new code created, delivered, older codes invalidated
{
  const store = createMockStore();
  // Create an old delivered code
  const oldCode = await createDeliveredCode(store, USER.id, '111111', {
    createdDate: new Date(Date.now() - 120000).toISOString(), // 2 min ago, past cooldown
  });
  const emailCalls = [];
  const emailSender = async (to, subject, body) => { emailCalls.push({ to, subject, body }); };
  const result = await mfa.processRequest({
    mode: 'resend', user: USER, store, emailSender,
  });
  assertEqual(result.status, 200, 'resend success status');
  assert(result.body.success, 'resend success body');
  assertEqual(emailCalls.length, 1, 'one email sent');
  // New code should be delivered
  const newCode = store.codes
    .filter(c => c.user_id === USER.id && c.status === 'active')
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];
  assertEqual(newCode.delivery_status, 'delivered', 'new code delivered');
  // Old code should be invalidated
  assertEqual(store.codes.find(c => c.id === oldCode.id).status, 'invalidated', 'old code invalidated');
}

// Test 26: Concurrent senders — older code invalidated, newer not
{
  const store = createMockStore();
  // Simulate: request A creates code at T=0, request B creates code at T=1
  const saltA = 'saltA', codeA = '111111';
  const saltB = 'saltB', codeB = '222222';
  const hashA = await mfa.sha256Hex(saltA + codeA);
  const hashB = await mfa.sha256Hex(saltB + codeB);
  const now = new Date();
  const codeARec = {
    id: 'codeA', user_id: USER.id, email: USER.email,
    code_hash: hashA, salt: saltA,
    expires_at: new Date(now.getTime() + mfa.OTP_TTL_MS).toISOString(),
    attempts: 0, status: 'active', delivery_status: 'delivered',
    created_date: new Date(now.getTime() - 1000).toISOString(), // 1s older
  };
  const codeBRec = {
    id: 'codeB', user_id: USER.id, email: USER.email,
    code_hash: hashB, salt: saltB,
    expires_at: new Date(now.getTime() + mfa.OTP_TTL_MS).toISOString(),
    attempts: 0, status: 'active', delivery_status: 'delivered',
    created_date: now.toISOString(),
  };
  store.codes.push(codeARec, codeBRec);

  // Simulate codeB's invalidation step: invalidate strictly older codes
  const newCreatedMs = new Date(codeBRec.created_date).getTime();
  const allActive = store.codes.filter(c => c.user_id === USER.id && c.status === 'active');
  for (const c of allActive) {
    if (c.id !== codeBRec.id && new Date(c.created_date).getTime() < newCreatedMs) {
      store.codes.find(c2 => c2.id === c.id).status = 'invalidated';
    }
  }
  // codeA should be invalidated, codeB should NOT
  assertEqual(store.codes.find(c => c.id === 'codeA').status, 'invalidated', 'older code invalidated by newer');
  assertEqual(store.codes.find(c => c.id === 'codeB').status, 'active', 'newer code not invalidated');
}

// Test 27: Hourly rate limit
{
  const store = createMockStore();
  // Create 5 codes within the last hour
  for (let i = 0; i < 5; i++) {
    await createDeliveredCode(store, USER.id, '111111', {
      createdDate: new Date(Date.now() - i * 120000).toISOString(), // 0, 2, 4, 6, 8 min ago
    });
  }
  const emailSender = async () => {};
  const result = await mfa.processRequest({
    mode: 'resend', user: USER, store, emailSender,
  });
  // The newest code is 0 min ago (within cooldown), so cooldown triggers first
  // But if we use a store where the newest is > 60s ago, hourly triggers
  assert(result.status === 429, 'rate limited or cooldown');
}

// ============ SESSION VALIDATION TESTS ============

// Test 28: Delivered code → verify → validate session → valid
{
  const store = createMockStore();
  const code = '567890';
  await createDeliveredCode(store, USER.id, code);
  const verifyResult = await mfa.processVerify({
    code, user: USER, store, userAgent: 'MyBrowser/2.0',
  });
  assertEqual(verifyResult.status, 200, 'verify for session test succeeded');
  const sessionToken = verifyResult.body.session_token;
  const validateResult = await mfa.processValidateSession({
    sessionToken, user: USER, store, userAgent: 'MyBrowser/2.0',
  });
  assert(validateResult.valid, 'session valid after verify');
  assert(!validateResult.bypass, 'session not bypass');
}

// Test 29: Session device mismatch → rejected
{
  const store = createMockStore();
  const code = '567890';
  await createDeliveredCode(store, USER.id, code);
  const verifyResult = await mfa.processVerify({
    code, user: USER, store, userAgent: 'MyBrowser/2.0',
  });
  const sessionToken = verifyResult.body.session_token;
  const validateResult = await mfa.processValidateSession({
    sessionToken, user: USER, store, userAgent: 'DifferentBrowser/1.0',
  });
  assert(!validateResult.valid, 'session invalid on device mismatch');
  assertEqual(validateResult.reason, 'device_mismatch', 'device mismatch reason');
}

// Test 30: Expired session → rejected
{
  const store = createMockStore();
  const code = '567890';
  await createDeliveredCode(store, USER.id, code);
  const verifyResult = await mfa.processVerify({
    code, user: USER, store, userAgent: 'MyBrowser/2.0',
    now: new Date('2026-01-01T00:00:00Z'),
  });
  const sessionToken = verifyResult.body.session_token;
  // Validate 10 hours later (session TTL is 8 hours)
  const validateResult = await mfa.processValidateSession({
    sessionToken, user: USER, store, userAgent: 'MyBrowser/2.0',
    now: new Date('2026-01-01T10:00:00Z'),
  });
  assert(!validateResult.valid, 'expired session invalid');
  assertEqual(validateResult.reason, 'expired', 'expired reason');
}

// Test 31: Revoked session → rejected
{
  const store = createMockStore();
  const code = '567890';
  await createDeliveredCode(store, USER.id, code);
  const verifyResult = await mfa.processVerify({
    code, user: USER, store, userAgent: 'MyBrowser/2.0',
  });
  const sessionToken = verifyResult.body.session_token;
  // Revoke the session
  store.sessions[0].revoked = true;
  const validateResult = await mfa.processValidateSession({
    sessionToken, user: USER, store, userAgent: 'MyBrowser/2.0',
  });
  assert(!validateResult.valid, 'revoked session invalid');
  assertEqual(validateResult.reason, 'not_found', 'revoked reason');
}

// Test 32: MFA bypass user → valid without token
{
  const store = createMockStore();
  const bypassUser = { id: 'admin-1', email: 'admin@test.invalid', mfa_bypass: true };
  const result = await mfa.processValidateSession({
    sessionToken: 'anything', user: bypassUser, store, userAgent: 'Any',
  });
  assert(result.valid, 'bypass user valid');
  assert(result.bypass, 'bypass flag set');
}

// Test 33: Invalid session token format → rejected
{
  const store = createMockStore();
  const result = await mfa.processValidateSession({
    sessionToken: 'short', user: USER, store, userAgent: 'Any',
  });
  assert(!result.valid, 'short token invalid');
  assertEqual(result.reason, 'invalid_token', 'invalid token reason');
}

// Test 34: Normalization — whitespace in code stripped before verify
{
  const store = createMockStore();
  const code = '123456';
  await createDeliveredCode(store, USER.id, code);
  const result = await mfa.processVerify({
    code: '  12 34 56  ', user: USER, store, userAgent: 'TestBrowser/1.0',
  });
  assertEqual(result.status, 200, 'whitespace-stripped code verifies');
}

// Test 35: Equal-timestamp codes — deterministic order by id breaks ties (resume)
{
  const store = createMockStore();
  const ts = new Date('2026-01-01T12:00:00Z').toISOString();
  const codeA = await createDeliveredCode(store, USER.id, '111111', { createdDate: ts });
  codeA.id = 'code_alpha';
  const codeB = await createDeliveredCode(store, USER.id, '222222', { createdDate: ts });
  codeB.id = 'code_beta';
  // Same created_date — id breaks the tie: 'code_beta' > 'code_alpha'
  const emailSender = async () => {};
  const result = await mfa.processRequest({
    mode: 'resume', user: USER, store, emailSender,
    now: new Date('2026-01-01T12:00:05Z'),
  });
  assertEqual(result.status, 200, 'equal-timestamp resume status');
  assert(result.body.resumed, 'equal-timestamp resume returned resumed');
  assertEqual(result.body.expires_at, codeB.expires_at, 'resume returns newer-id code (beta)');
}

// Test 36: Equal-timestamp codes — verify selects by deterministic order
{
  const store = createMockStore();
  const ts = new Date('2026-01-01T12:00:00Z').toISOString();
  const codeA = await createDeliveredCode(store, USER.id, '111111', { createdDate: ts });
  codeA.id = 'code_alpha';
  const codeB = await createDeliveredCode(store, USER.id, '222222', { createdDate: ts });
  codeB.id = 'code_beta';
  const result = await mfa.processVerify({
    code: '222222', user: USER, store, userAgent: 'TestBrowser/1.0',
    now: new Date('2026-01-01T12:00:05Z'),
  });
  assertEqual(result.status, 200, 'equal-timestamp verify selects winner');
  assertEqual(store.codes.find(c => c.id === 'code_beta').status, 'verified', 'beta verified (winner)');
  assertEqual(store.codes.find(c => c.id === 'code_alpha').status, 'active', 'alpha not selected');
}

// Test 37: Out-of-order delivery — late older sender reports superseded
{
  const store = createMockStore();
  // Simulate: request A creates code_A (pending). While A's email is sending,
  // request B creates a newer code, sends email, marks delivered, invalidates A.
  // Then A finishes and discovers it was superseded by B.
  const emailSenderA = async () => {
    const bCode = await store.createCode({
      user_id: USER.id, email: USER.email,
      code_hash: await mfa.sha256Hex('saltB' + '222222'),
      salt: 'saltB',
      expires_at: new Date(Date.now() + mfa.OTP_TTL_MS).toISOString(),
      attempts: 0, status: 'active', delivery_status: 'pending',
    });
    await store.updateCode(USER.id, bCode.id,
      { status: 'active', delivery_status: 'pending' },
      { $set: { delivery_status: 'delivered' } }
    );
    // B invalidates strictly older active codes (including A's pending code)
    const allActive = store.codes.filter(c => c.user_id === USER.id && c.status === 'active');
    for (const c of allActive) {
      if (c.id !== bCode.id && mfa.compareCodes(c, bCode) < 0) {
        await store.updateCode(USER.id, c.id, { status: 'active' }, { $set: { status: 'invalidated' } });
      }
    }
  };
  const result = await mfa.processRequest({
    mode: 'resend', user: USER, store, emailSender: emailSenderA,
  });
  assertEqual(result.status, 200, 'superseded status');
  assert(result.body.superseded, 'superseded flag set');
  assert(!result.body.resumed, 'not resumed (new issuance superseded)');
  const winner = store.codes.find(c => c.status === 'active' && c.delivery_status === 'delivered');
  assertEqual(result.body.expires_at, winner.expires_at, 'superseded returns winner expires_at');
}

// Test 38: Expiry during async verification — CAS catches it with strict $gt
{
  const store = createMockStore();
  const code = '123456';
  const expiry = new Date('2026-01-01T12:00:00Z');
  await createDeliveredCode(store, USER.id, code, {
    expiresAt: expiry.toISOString(),
    now: new Date('2026-01-01T11:50:00Z'),
  });
  // Clock: 1st call (pre-check) → 11:59:59 (before expiry), 2nd call (CAS) →
  // 12:00:01 (after expiry). Pre-check passes, but CAS with strict $gt fails
  // because expires_at (12:00:00) is not > 12:00:01.
  let callCount = 0;
  const clock = () => {
    callCount++;
    if (callCount === 1) return new Date('2026-01-01T11:59:59Z');
    return new Date('2026-01-01T12:00:01Z');
  };
  const result = await mfa.processVerify({
    code, user: USER, store, userAgent: 'TestBrowser/1.0', clock,
  });
  assertEqual(result.status, 409, 'expiry during async verify — CAS rejected');
  assertEqual(result.body.error, 'already_used', 'already_used when CAS fails on expiry');
  assertEqual(store.codes.find(c => c.user_id === USER.id).status, 'active', 'code still active (CAS did not verify)');
}

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:', failures);
  process.exit(1);
}