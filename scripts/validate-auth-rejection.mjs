import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

// Execute the actual provider with isolated React hooks and SDK boundaries.
// No live accounts, requests, credentials, cookies or money are touched.
const source = await readFile(new URL('../src/lib/AuthContext.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs', target: 'node20' });
function fixture() {
  const hooks = [], timers = new Map();
  let cursor = 0, meResult = { id: 'disposable-fixture', welcome_email_sent: true }, trackError;
  const calls = { logout: [], mfa: 0, cache: 0, functions: [] };
  const react = {
    createContext: () => ({ Provider: {} }),
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useEffect() {},
    useContext() {},
    createElement: (type, props) => ({ type, props }),
  };
  const base44 = {
    auth: {
      async me() { if (meResult instanceof Error || meResult?.failure) throw meResult; return meResult; },
      logout(url) { calls.logout.push(url); },
      redirectToLogin() { throw new Error('Unexpected competing login redirect'); },
    },
    functions: { async invoke(name) { calls.functions.push(name); return { data: {} }; } },
  };
  const window = {
    location: { href: 'https://example.test/play' },
    setTimeout(fn, delay) { const id = timers.size + 1; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const modules = {
    react,
    '@/api/base44Client': { base44 },
    '@/lib/app-params': { appParams: { appId: 'fixture', token: 'not-a-credential' } },
    '@base44/sdk/dist/utils/axios-client': { createAxiosClient() { throw new Error('Unexpected public-settings request'); } },
    '@/lib/mfaSession': { clearMfaVerified() { calls.mfa++; } },
    '@/lib/query-client': { queryClientInstance: { clear() { calls.cache++; } } },
    '@/lib/googleAnalytics': { trackCompletedOAuthLogin() { if (trackError) throw trackError; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    assert.ok(name in modules, 'Unexpected dependency: ' + name); return modules[name];
  }, window, console: { error() {} } });
  const value = () => { cursor = 0; return module.exports.AuthProvider({ children: null }).props.value; };
  return { calls, timers, value, setMe: v => { meResult = v; }, setTrackError: e => { trackError = e; } };
}
let cases = 0;
for (const status of [401, 403, 404]) {
  for (const shape of ['status', 'response']) {
    const f = fixture();
    await f.value().checkUserAuth();
    assert.equal(f.value().isAuthenticated, true);
    f.setMe({ failure: true, ...(shape === 'status' ? { status } : { response: { status } }) });
    await f.value().checkUserAuth();
    const state = f.value();
    assert.equal(state.user, null);
    assert.equal(state.isAuthenticated, false);
    assert.equal(state.authChecked, true);
    assert.equal(state.isLoadingAuth, false);
    assert.equal(state.authError, null, 'SDK logout owns the redirect');
    assert.equal(f.calls.mfa, 1);
    assert.equal(f.calls.cache, 1);
    assert.deepEqual(f.calls.logout, ['https://example.test/play']);
    assert.equal(f.timers.size, 0, 'Rejected sessions do not retry indefinitely');
    assert.deepEqual(f.calls.functions, []);
    cases++;
  }
}
for (const status of [undefined, 400, 409, 422, 429, 500, 503]) {
  const f = fixture();
  await f.value().checkUserAuth();
  const user = f.value().user;
  f.setMe(status === undefined ? new Error('offline') : { failure: true, status });
  await f.value().checkUserAuth();
  assert.equal(f.value().user, user, 'Unconfirmed failure preserves identity');
  assert.equal(f.value().isAuthenticated, true);
  assert.equal(f.value().isLoadingAuth, true);
  assert.equal(f.calls.mfa + f.calls.cache + f.calls.logout.length, 0);
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 1000);
  f.setMe(user);
  timer.fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.value().isLoadingAuth, false, 'Reconnect succeeds without logout');
  cases++;
}
// Errors outside auth.me, including a missing unrelated resource, cannot revoke identity.
for (const status of [401, 403, 404]) {
  const f = fixture();
  f.setTrackError({ status });
  await f.value().checkUserAuth();
  assert.equal(f.value().isAuthenticated, true);
  assert.equal(f.calls.mfa + f.calls.cache + f.calls.logout.length, 0);
  cases++;
}
console.log('Auth rejection validation passed: ' + cases + ' isolated provider scenarios; identity-only rejection, private-state cleanup, transient recovery and unrelated-error isolation.');
