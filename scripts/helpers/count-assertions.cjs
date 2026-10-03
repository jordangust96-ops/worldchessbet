// Counts completed assertion-method calls without changing assertions or outcomes.
const assert = require('node:assert/strict');
let passed = 0;
for (const name of Object.keys(assert)) {
  if (typeof assert[name] !== 'function' || ['AssertionError', 'CallTracker', 'strict'].includes(name)) continue;
  const original = assert[name];
  assert[name] = function (...args) {
    const result = Reflect.apply(original, assert, args);
    if (result && typeof result.then === 'function') return result.then(value => { passed++; return value; });
    passed++;
    return result;
  };
}
globalThis.fetch = async () => { throw new Error('Live network is disabled in isolated withdrawal verification'); };
process.on('exit', code => console.log(`[assertion-count] ${passed} completed; exit ${code}`));