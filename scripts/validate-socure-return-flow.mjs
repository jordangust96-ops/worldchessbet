import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadBackend} from './helpers/load-backend.mjs';
import * as policy from '../base44/shared/socureKycPolicy.js';
import * as eligibility from '../base44/shared/identityEligibility.js';
const source=await readFile('src/components/wallet/SocureIdentityStep.jsx','utf8');
const stepModule={exports:{}};
vm.runInNewContext(transformSync(await readFile('src/components/wallet/WalletSetupStep.jsx','utf8'),{loader:'jsx',format:'cjs'}).code,{
 module:stepModule,exports:stepModule.exports,require:name=>{
 if(name==='react')return React;
 if(name==='lucide-react')return {Check:()=>null,Clock:()=>null,AlertTriangle:()=>null};
 throw Error(name);
 }});
const uiModule={exports:{}};
vm.runInNewContext(transformSync(source,{loader:'jsx',format:'cjs'}).code,{
 module:uiModule,exports:uiModule.exports,require:name=>{
 if(name==='react')return React;
 if(name==='lucide-react')return {ShieldCheck:()=>null,Loader2:()=>null,CheckCircle2:()=>null,Clock:()=>null,AlertTriangle:()=>null};
 if(name==='@/api/base44Client')return {base44:{}};
 if(name==='./WalletSetupStep')return stepModule.exports;
 throw Error(name);
 }});
const Component=uiModule.exports.default;
for(const [status,title] of Object.entries({pending:'Confirming verification status',incomplete:'Verification not completed',review_required:'Verification submitted — under review',rejected:'Verification not approved',verified:'Identity Verified',not_started:'Verify your identity',expired:'Verification expired',failed:'Verification could not be completed'})){
 const html=renderToStaticMarkup(React.createElement(Component,{identity:{status,verified:status==='verified',enabled:true,can_start:true},onNextStep:()=>{}}));
 assert.ok(html.includes(title));
 if(['pending','review_required','rejected','verified'].includes(status))assert.ok(!html.includes('type="checkbox"'),status+' should not show new consent by default');
 assert.ok(!html.includes('Check verification status'));
 assert.ok(!html.includes('mailto:'));
 if(['pending','review_required','rejected','verified'].includes(status))assert.ok(!html.includes('<button'));
 if(status==='incomplete')assert.ok(html.includes('Start verification over'));
}
const submittedHtml=renderToStaticMarkup(React.createElement(Component,{identity:{status:'pending',submitted:true,enabled:true,can_start:true}}));
assert.ok(submittedHtml.includes('Verification submitted — pending'));
assert.ok(!submittedHtml.includes('<button'));
for(const status of ['failed','expired']) {
 const html=renderToStaticMarkup(React.createElement(Component,{identity:{status,submitted:true,enabled:true,can_start:true}}));
 assert.ok(!html.includes('<button'),'completed submissions remain status-only');
}
async function stateFor(row){
 const sdk={asServiceRole:{entities:{User:{get:async()=>({id:'u1',account_state:'provisional'})},SocureIdentityVerification:{filter:async()=>[row]}}}};
 const {exports}=await loadBackend('base44/shared/identityState.ts',{
 './identityEligibility.js':{hasVerifiedIdentity:async()=>false,KYC_POLICY_VERSION:policy.POLICY_VERSION},
 './socureIdentity.ts':{identityConfig:()=>({enabled:true})}
 });
 return exports.identityState(sdk,{id:'u1'});
}
let view=await stateFor({status:'pending',expires_at:'2020-01-01'});
assert.equal(view.status,'pending');assert.equal(view.can_start,false,'timeout alone cannot justify restart');
view=await stateFor({status:'pending',failure_code:'hosted_verification_incomplete',provider_checked_at:new Date().toISOString()});
assert.equal(view.status,'incomplete');assert.equal(view.can_start,true);
view=await stateFor({status:'pending',completed_at:new Date().toISOString(),failure_code:'hosted_verification_incomplete',provider_checked_at:new Date().toISOString()});
assert.equal(view.status,'pending');assert.equal(view.submitted,true);assert.equal(view.can_start,false);
const decisionAt=new Date(Date.now()-30000).toISOString();
const data={id:'request1',eval_id:'eval1',workflow:'consumer_onboarding',environment_name:'Production',eval_status:'evaluation_completed',decision:'ACCEPT',decision_at:decisionAt,data_enrichments:[{enrichment_provider:'Socure',status_code:200,request:{dob:'1990-01-01',firstName:'Test',surName:'Player'},response:{kyc:{fieldValidations:{dob:0.99,firstName:0.99,surName:0.99}}}}]};
async function harness({auth=true,lock=true,provider=data,failProvider=false,failUserOnce=false,restricted=false,superseded=false}={}){
 let user={id:'u1',account_state:restricted?'suspended':'provisional',identity_verification_provider:'socure',identity_provider_reference:superseded?'other':'eval1'};
 let row={id:'v1',user_id:'u1',request_id:'request1',provider_evaluation_id:'eval1',policy_version:policy.POLICY_VERSION,workflow:'consumer_onboarding',environment:'production',status:'pending',requested_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+600000).toISOString()};
 let calls=0,writes=0;
 const sdk={auth:{me:async()=>auth?{id:'u1'}:null},asServiceRole:{entities:{
 User:{get:async()=>({...user}),update:async(id,p)=>{if(failUserOnce){failUserOnce=false;throw Error('db');}user={...user,...p};writes++;}},
 SocureIdentityVerification:{filter:async()=>[{...row}],update:async(id,p)=>{row={...row,...p};}}
 }}};
 const {handler}=await loadBackend('base44/functions/refreshSocureIdentityVerification/entry.ts',{
 'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
 '../../shared/socureIdentity.ts':{identityWebhookConfig:()=>({}),readIdentityEvaluation:async()=>{calls++;if(failProvider)throw Error('unavailable');return provider;}},
 '../../shared/socureKycPolicy.js':policy,
 '../../shared/identityEligibility.js':{hasVerifiedIdentity:async()=>eligibility.isVerifiedKycEvidence(row,user)},
 '../../shared/kycEvidenceArchive.ts':{encryptComplianceJson:async()=>({ciphertext:'encrypted',iv:'iv',sha256:'hash'})},
 '../../shared/achAuthorization.js':{complianceRetentionUntil:()=>new Date(Date.now()+2*365*86400000).toISOString()},
 '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>lock,releaseUserWalletLock:async()=>{}}
 });
 return {send:()=>handler(new Request('https://test.invalid',{method:'POST',body:'{"user_id":"other","approved":true}'})),state:()=>({row,user,calls,writes})};
}
let h=await harness();assert.equal((await h.send()).status,200);assert.equal(h.state().user.identity_verification_status,'verified');assert.equal(eligibility.isVerifiedKycEvidence(h.state().row,h.state().user),true);
assert.equal((await h.send()).status,200);assert.equal(h.state().calls,1);
assert.equal(eligibility.isVerifiedKycEvidence({...h.state().row,provider_result_reference:'wrong'},h.state().user),false);
assert.equal(eligibility.isVerifiedKycEvidence({...h.state().row,provider_report_ciphertext:''},h.state().user),false);
h=await harness({auth:false});assert.equal((await h.send()).status,401);assert.equal(h.state().calls,0);
h=await harness({lock:false});assert.equal((await h.send()).status,409);assert.equal(h.state().calls,0);
h=await harness({superseded:true});await h.send();assert.equal(h.state().calls,0);assert.equal(h.state().writes,0);
h=await harness({provider:{...data,id:'wrong'}});assert.equal((await h.send()).status,503);assert.equal(h.state().writes,0);
h=await harness({provider:{...data,data_enrichments:[]}});await h.send();assert.equal(h.state().user.identity_verification_status,'review_required');
h=await harness({provider:{...data,decision:'REJECT'}});await h.send();assert.equal(h.state().user.identity_verification_status,'rejected');
h=await harness({restricted:true});await h.send();assert.equal(h.state().user.account_state,'suspended');
h=await harness({failProvider:true});assert.equal((await h.send()).status,503);await h.send();assert.equal(h.state().calls,1);assert.equal(h.state().writes,0);
h=await harness({failUserOnce:true});assert.equal((await h.send()).status,503);assert.equal(h.state().row.status,'verified');assert.equal((await h.send()).status,200);assert.equal(h.state().user.identity_verification_status,'verified');assert.equal(h.state().calls,1);
console.log('Return flow: seven rendered UI states, consent gating, authenticated recovery, evidence provenance, correlation, restrictions, throttling, rejection and partial-write repair passed.');
