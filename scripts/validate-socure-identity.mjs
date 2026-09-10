import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBackend } from './helpers/load-backend.mjs';
import * as policy from '../base44/shared/socureKycPolicy.js';
import * as eligibility from '../base44/shared/identityEligibility.js';
import { meetsStateAge, STATE_MINIMUM_AGES } from '../base44/shared/playerAgePolicy.js';
const now = new Date('2026-09-10T12:00:00Z');
assert.equal(policy.ageOn('2005-09-10', now), 21);
assert.equal(policy.ageOn('2005-09-11', now), 20);
for (const dob of ['', '2005-02-30', '2028-01-01', '09/10/2000', null]) assert.equal(policy.ageOn(dob, now), null);
const enrichment = dob => ({ enrichment_provider:'Socure', status_code:200, request:{date_of_birth:dob},
  response:{kyc:{fieldValidations:{dob:0.99,firstName:0.99,surName:0.99}}}});
const data = { id:'request-1', eval_id:'eval-1', workflow:'consumer_onboarding', environment_name:'Production',
  eval_status:'evaluation_completed', decision:'ACCEPT', data_enrichments:[enrichment('1990-01-01')] };
assert.equal(policy.classifyKyc(data,now).status,'verified');
assert.equal(policy.classifyKyc({...data,data_enrichments:[]},now).status,'review_required');
assert.equal(policy.classifyKyc({...data,environment_name:'Sandbox'},now).status,'review_required');
assert.equal(policy.classifyKyc({...data,workflow:'account_intelligence_screening'},now).status,'review_required');
assert.equal(policy.classifyKyc({...data,decision:'REVIEW'},now).status,'review_required');
assert.equal(policy.classifyKyc({...data,decision:'REJECT'},now).status,'rejected');
assert.equal(policy.classifyKyc({...data,data_enrichments:[enrichment('2005-09-11')]},now).status,'rejected');
assert.equal(policy.classifyKyc({...data,data_enrichments:[enrichment('2005-09-10')]},now).status,'verified');
assert.equal(policy.classifyKyc({...data,data_enrichments:[enrichment('1990-01-01'),enrichment('1991-01-01')]},now).status,'review_required');
const mismatch=enrichment('1990-01-01'); mismatch.response.kyc.fieldValidations.dob=0.01;
assert.equal(policy.classifyKyc({...data,data_enrichments:[mismatch]},now).status,'review_required');
const doc={ enrichment_provider:'Socure',status_code:200,response:{documentVerification:{decision:{value:'accept'},documentData:{dob:'1990-01-01'}}}};
assert.equal(policy.classifyKyc({...data,data_enrichments:[doc]},now).status,'verified');
const user={id:'u1',account_state:'verified',identity_verification_status:'verified',identity_verification_provider:'socure',
 identity_provider_reference:'eval-1',identity_policy_version:eligibility.KYC_POLICY_VERSION,identity_age_verified:true,identity_age_over_21:true};
const row={id:'v1',user_id:'u1',request_id:'request-1',provider_evaluation_id:'eval-1',workflow:'consumer_onboarding',
 environment:'production',policy_version:eligibility.KYC_POLICY_VERSION,status:'verified',provider_decision:'ACCEPT',age_verified:true,age_over_21:true,
 webhook_event_id:'event-1',provider_report_ciphertext:'encrypted',provider_report_sha256:'hash',verified_valid_until:'2099-01-01T00:00:00Z'};
assert.equal(eligibility.isVerifiedKycEvidence(row,user),true);
for (const changed of [{identity_verification_provider:'seamless_ach_plaid'},{identity_age_over_21:false},{account_state:'suspended'},{identity_policy_version:''}])
 assert.equal(eligibility.isVerifiedKycEvidence(row,{...user,...changed}),false);
for (const changed of [{user_id:'other'},{provider_evaluation_id:'other'},{environment:'sandbox'},{provider_report_ciphertext:''},{verified_valid_until:'2020-01-01T00:00:00Z'}])
 assert.equal(eligibility.isVerifiedKycEvidence({...row,...changed},user),false);
for(const state of Object.keys(STATE_MINIMUM_AGES)) assert.equal(meetsStateAge(user,state),true);
assert.equal(meetsStateAge(user,'ZZ'),false);
assert.equal(meetsStateAge({...user,identity_age_over_21:false},'TX'),false);

async function webhookHarness({failUserOnce=false,lock=true,restricted=false}={}) {
 let current={...user,account_state:restricted?'suspended':'provisional',identity_verification_status:'pending'};
 let record={...row,status:'pending',webhook_event_id:'',provider_report_ciphertext:''}; let writes=0, archives=0, releases=0;
 const sdk={asServiceRole:{entities:{
  User:{get:async()=>({...current}),update:async(id,patch)=>{ if(failUserOnce){failUserOnce=false;throw Error('infrastructure');} current={...current,...patch};writes++;}},
  SocureIdentityVerification:{filter:async()=>[{...record}],get:async()=>({...record}),update:async(id,patch)=>{record={...record,...patch};}}
 }}};
 const {handler}=await loadBackend('base44/functions/socureIdentityWebhook/entry.ts',{
  'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
  '../../shared/socureIdentity.ts':{identityConfig:()=>({enabled:true,webhookToken:'test-token'}),constantTimeEqual:(a,b)=>a===b},
  '../../shared/kycEvidenceArchive.ts':{encryptComplianceJson:async()=>{archives++;return {ciphertext:'encrypted',iv:'iv',sha256:'hash'};}},
  '../../shared/socureKycPolicy.js':policy,
  '../../shared/achAuthorization.js':{complianceRetentionUntil:()=> '2028-09-10T00:00:00Z'},
  '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>lock,releaseUserWalletLock:async()=>{releases++;}},
  '../../shared/integrationEvents.ts':{recordIntegrationEvent:async()=>{}}
 });
 const send=async(change={},token='test-token')=>handler(new Request('https://test.invalid',{method:'POST',
  headers:{authorization:'Bearer '+token},body:JSON.stringify({event_type:'evaluation_completed',event_id:'event-new',event_at:new Date().toISOString(),data,...change})}));
 return {send,state:()=>({current,record,writes,archives,releases})};
}
let h=await webhookHarness();
assert.equal((await h.send({},'wrong')).status,401);assert.equal(h.state().writes,0);
assert.equal((await h.send({data:{...data,id:'wrong'}})).status,400);assert.equal(h.state().writes,0);
assert.equal((await h.send()).status,200);assert.equal(h.state().current.identity_verification_status,'verified');
assert.equal((await h.send()).status,200);assert.equal(h.state().archives,1,'duplicate does not archive or bill twice');
h=await webhookHarness({failUserOnce:true});
assert.equal((await h.send()).status,503);assert.equal(h.state().record.status,'verified');
assert.equal((await h.send()).status,200);assert.equal(h.state().current.identity_verification_status,'verified','replay repairs partial projection');
h=await webhookHarness({lock:false}); assert.equal((await h.send()).status,503);assert.equal(h.state().writes,0);
h=await webhookHarness({restricted:true});await h.send();assert.equal(h.state().current.account_state,'suspended');
h=await webhookHarness();await h.send({data:{...data,data_enrichments:[]}});assert.equal(h.state().current.identity_verification_status,'review_required');
h=await webhookHarness();await h.send({data:{...data,workflow:'account_intelligence_screening'}});assert.equal(h.state().writes,0);
for(const fn of ['submitSeamlessDeposit','submitSeamlessWithdrawal','lockWager','runContestEligibility','closeAccount']){
 const code=await readFile('base44/functions/'+fn+'/entry.ts','utf8');
 assert.ok(code.includes('await hasVerifiedIdentity(base44, user)'),fn+' must use retained server KYC evidence');
}
for(const fn of ['seamlessAchWebhook','manageSeamlessBankAccount']){
 const code=await readFile('base44/functions/'+fn+'/entry.ts','utf8');
 assert.ok(!code.includes('identity_verification_status:'),fn+' cannot grant or revoke player KYC');
}
console.log('Socure KYC: age boundaries, evidence, fail-closed gates, webhook auth, correlation, replay recovery and bank separation passed.');

