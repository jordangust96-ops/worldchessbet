import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { evaluateJurisdictionAccess, getJurisdictionCheck } from "../src/lib/jurisdictionAccess.js";

const source = fs.readFileSync("src/components/wallet/DepositLocationStep.jsx", "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true
} }).outputText;
function mount(invoke, decision = null, user = { id: "test-user", email: "test@example.invalid" }) {
  const delivered = [];
  const dependencies = {
    react: { ...React, useState: () => [false, () => {}], useRef: value => ({ current: value }) },
    "@/lib/AuthContext": { useAuth: () => ({ user }) },
    "@/api/base44Client": { base44: { functions: { invoke } } },
    "@/lib/jurisdictionAccess": { evaluateJurisdictionAccess, getJurisdictionCheck },
    "@/lib/jurisdictionConfig": { APPROVED_STATES: ["GA"] },
    "@/lib/jurisdictionRegions": { getRegionName: () => "Georgia" },
    "@/components/jurisdiction/JurisdictionWaitlistOptIn": () => null,
    "./WalletSetupStep": () => null,
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (!(name in dependencies)) throw Error("Unexpected dependency " + name);
    return dependencies[name];
  } });
  const tree = module.exports.default({ decision, onDecision: d => delivered.push(d) });
  return { tree, delivered, button: tree.props.children[0] };
}
let calls = 0, resolve;
const mounted = mount((name, payload) => {
  calls++;
  assert.equal(name, "verifyWalletOnboardingLocation");
  assert.equal(Object.keys(payload).length, 0);
  return new Promise(r => { resolve = r; });
});
assert.equal(calls, 0, "rendering the wallet step never checks location");
assert.equal(mounted.button.props.children, "Verify location");
const first = mounted.button.props.onClick();
const duplicate = mounted.button.props.onClick();
await Promise.resolve();
assert.equal(calls, 1, "repeated clicks while pending cause only one lookup");
resolve({ data: { status: "approved", allowed: true, approved: true, country: "US", state: "GA", enforcementEnabled: true, vpnDetected: false } });
await Promise.all([first, duplicate]);
assert.equal(mounted.delivered.length, 1);
assert.equal(mounted.delivered[0].allowed, true);
const failed = mount(async () => { throw Error("network failure"); });
await failed.button.props.onClick();
assert.equal(failed.delivered[0].allowed, false);
assert.equal(failed.delivered[0].promptEligible, false);
const uncertain = mount(async () => ({ data: { status: "verification_failed", allowed: false, promptEligible: false, approved: false, country: "US", state: "GA", enforcementEnabled: true, vpnDetected: false } }));
await uncertain.button.props.onClick();
assert.equal(uncertain.delivered[0].allowed, false);
assert.equal(uncertain.delivered[0].promptEligible, false);
const retry = mount(() => { throw Error("must not run during render"); }, uncertain.delivered[0]);
assert.equal(retry.button.props.children, "Check location again");
const approved = mount(() => { throw Error("must not run during render"); }, { allowed: true });
assert.equal(approved.button, false);
const anonymous = mount(() => { throw Error("anonymous lookup"); }, null, null);
assert.equal(anonymous.button.props.disabled, true);
await anonymous.button.props.onClick();
assert.equal(anonymous.delivered.length, 0);
console.log("Deposit intent passed: no render lookup; explicit start; pending-click deduplication; approval; failure; uncertainty; retry; anonymous refusal.");
