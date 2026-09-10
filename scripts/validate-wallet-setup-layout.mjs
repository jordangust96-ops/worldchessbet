import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
function load(path, dependencies = {}) {
  const source = fs.readFileSync(path, "utf8");
  const code = ts.transpileModule(source, {compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:name => {
    if(name==="react") return React;
    if(name==="lucide-react") return icons;
    if(name in dependencies) return dependencies[name];
    throw new Error("Unexpected dependency "+name);
  }});
  return module.exports.default;
}
const Step=load("src/components/wallet/WalletSetupStep.jsx");
const Identity=load("src/components/wallet/SocureIdentityStep.jsx",{"./WalletSetupStep":Step,"@/api/base44Client":{base44:{}}});
for (const status of ["verified","pending","review_required","rejected","incomplete","expired","failed","not_started","unknown"]) {
  const submitted=["pending","review_required","rejected"].includes(status);
  const html=renderToStaticMarkup(React.createElement(Identity,{identity:{status,verified:status==="verified",submitted,can_start:true,enabled:true},locationApproved:true}));
  assert.match(html,/Identity verification/);
  assert.equal(html.includes('type="checkbox"'),["incomplete","expired","failed","not_started"].includes(status));
  assert.equal(html.includes("text-emerald-300"),status==="verified");
  assert.ok(!html.includes("Check verification status"));
}
const waiting=renderToStaticMarkup(React.createElement(Identity,{identity:{status:"not_started",can_start:true,enabled:true},locationApproved:false}));
assert.match(waiting,/First, verify your location above/);
assert.ok(!waiting.includes('type="checkbox"'));
const panel=fs.readFileSync("src/components/wallet/SeamlessFundingPanel.jsx","utf8");
assert.ok(panel.indexOf('<DepositLocationStep')<panel.indexOf("<SocureIdentityStep"));
assert.ok(panel.indexOf("<SocureIdentityStep")<panel.indexOf('label="Bank connection"'));
assert.match(panel,/complete={depositSourceReady}/);
assert.match(panel,/Wallet setup/);
assert.match(panel,/wallet-transfer-amount/);
assert.match(panel,/Disconnect bank/);
assert.match(panel,/Change or add a bank account/);
console.log("Wallet setup layout passed: aligned shared rows, all identity states, consent/restart preservation, authoritative bank status, and preserved funding controls.");
