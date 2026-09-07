// Exercise the real deployed-handler source with mocked SDK I/O.
// No network, providers, emails, or application records are touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let assertions = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
const names = [
  'generateDailyOperationsBrief', 'awardFoundingPlayerOnSignup',
  'notifyMatchAccepted', 'sendWelcomeEmail', 'settleMatch',
  'reconcilePendingSettlements', 'processJurisdictionApprovalNotifications',
];
async function exercise(name, caller, body = {}, overrides = {}) {
  let handler;
  const calls = [];
  const entities = new Proxy({}, { get: (_, entity) => new Proxy({}, {
    get: (_, operation) => async (...args) => {
      calls.push([entity, operation]);
      if (overrides[entity]?.[operation]) return overrides[entity][operation](...args);
      throw new Error('STOP_AT_AUTHORIZED_IO');
    },
  }) });
  const client = {
    auth: { me: async () => {
      if (caller === 'throws') throw new Error('invalid session');
      return caller;
    } },
    asServiceRole: {
      entities,
      integrations: new Proxy({}, { get: () => { throw new Error('UNEXPECTED_INTEGRATION'); } }),
      functions: { invoke: () => { throw new Error('UNEXPECTED_FUNCTION'); } },
    },
  };
  let source = fs.readFileSync('base44/functions/' + name + '/entry.ts', 'utf8');
  source = source.replace(/^import\s[\s\S]*?;\s*$/gm, '');
  source = source.replace('export default async function(req)', 'handler = async function(req)');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  });
  const errors = (js.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  check(errors.length, 0, name + ': source parses');
  const sandbox = {
    createClientFromRequest: () => client,
    Deno: { serve: fn => { handler = fn; }, env: { get: () => 'https://example.invalid' } },
    console: { log() {}, error() {}, warn() {} },
    Response, Request, TextEncoder, URL, Intl, Date,
    REPORT_WINDOW_MS: 86400000,
    FOUNDING_PLAYER_CAP: 250,
    ensureUserWallet: async () => ({ id: 'wallet-fixture' }),
    setTimeout: () => { throw new Error('UNEXPECTED_TIMER'); },
    handler: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(js.outputText, sandbox);
  handler ||= sandbox.handler;
  assert.equal(typeof handler, 'function', name + ': handler exported');
  const response = await handler(new Request('https://example.invalid', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json(), calls };
}

const outsider = { id: 'outsider', role: 'user' };
const admin = { id: 'admin-fixture', role: 'admin' };
const participant = { id: 'player1', role: 'user' };
for (const name of names) {
  for (const identity of [null, 'throws']) {
    const result = await exercise(name, identity, { userId: 'victim', gameId: 'game', matchId: 'match', run_token: 'retired-token' });
    check(result.status, 401, name + ': missing/invalid authentication rejected');
    check(result.calls, [], name + ': rejected before service-role I/O');
  }
}
for (const name of names.filter(n => n !== 'settleMatch')) {
  const result = await exercise(name, outsider, { userId: 'victim', matchId: 'match', run_token: 'retired-token' });
  check(result.status, 403, name + ': unrelated user denied');
  check(result.calls, [], name + ': authorization precedes service-role I/O');
}
const game = { id: 'game', match_id: 'match', launch_epoch: 2, status: 'completed' };
for (const hold of [false, true]) {
  const match = { id: 'match', player1_id: 'player1', player2_id: 'player2', status: 'completed', settlement_hold: hold };
  const fixtures = { Game: { get: async () => game }, Match: { get: async () => match } };
  const denied = await exercise('settleMatch', outsider, { gameId: 'game' }, fixtures);
  check(denied.status, 403, 'unrelated user cannot inspect or settle another match');
  check(denied.calls, [['Game', 'get'], ['Match', 'get']], 'no settlement writes for unrelated user');
  for (const actor of [participant, { id: 'player2', role: 'user' }, admin]) {
    const allowed = await exercise('settleMatch', actor, { gameId: 'game' }, fixtures);
    check(allowed.status, 200, 'participant/admin preserved for completed or held match');
    check(allowed.calls, [['Game', 'get'], ['Match', 'get']], 'idempotent/hold path remains read-only');
  }
}
for (const actor of [participant, admin]) {
  const result = await exercise('sendWelcomeEmail', actor, { userId: 'player1' },
    { User: { get: async () => ({ id: 'player1', welcome_email_sent: true }) } });
  check(result.status, 200, 'self/admin welcome access preserved');
  check(result.body, { alreadySent: true }, 'welcome idempotency preserved');
}
for (const name of ['awardFoundingPlayerOnSignup', 'notifyMatchAccepted', 'settleMatch', 'sendWelcomeEmail']) {
  const result = await exercise(name, admin, {});
  check(result.status, 400, name + ': admin reaches input validation');
  check(result.calls, [], name + ': empty admin request has no side effects');
}
for (const name of ['generateDailyOperationsBrief', 'reconcilePendingSettlements', 'processJurisdictionApprovalNotifications']) {
  const result = await exercise(name, admin);
  check(result.status, 500, name + ': test deliberately stops at first authorized I/O');
  assert.ok(result.calls.length > 0, name + ': admin/workflow allowed through gate');
  assertions++;
}
const workflow = JSON.parse(fs.readFileSync('base44/workflows/JurisdictionApprovalNotifications.jsonc', 'utf8'));
check(workflow.definition.do[0].process_notifications.with.args, {}, 'workflow contains no reusable bearer secret');
const processor = fs.readFileSync('base44/functions/processJurisdictionApprovalNotifications/entry.ts', 'utf8');
check(/run_token|JURISDICTION_PROCESSOR_RUN_TOKEN|timingSafeStringEqual/.test(processor), false, 'retired workflow token cannot authorize requests');
console.log('Security authorization regression checks passed: ' + assertions + ' assertions.');
