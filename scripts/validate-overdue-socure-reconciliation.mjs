import assert from 'node:assert/strict';
import { loadBackend } from './helpers/load-backend.mjs';
import * as policy from '../base44/shared/socureKycPolicy.js';
const requested = new Date(Date.now()-3600000).toISOString();
const expires = new Date(Date.now()-1800000).toISOString();
const completed = new Date(Date.now()-2400000).toISOString();
const accepted = {id:'r1',eval_id:'e1',workflow:'consumer_onboarding',environment_name:'Production',
  eval_status:'evaluation_completed',decision:'ACCEPT',decision_at:completed,eval_end_time:completed,
  data_enrichments:[{enrichment_provider:'Socure',status_code:200,
    request:{dob:'1990-01-01',firstName:'Test',surName:'Player'},
    response:{kyc:{fieldValidations:{dob:0.99,firstName:0.99,surName:0.99}}}}]};
async function run({provider={...accepted,eval_status:'evaluation_paused',decision:'REVIEW'}, auth='admin',
  lock=true, superseded=false, unavailable=false}={}){
  let row={id:'v1',user_id:'u1',request_id:'r1',provider_evaluation_id:'e1',workflow:'consumer_onboarding',
    environment:'production',policy_version:policy.POLICY_VERSION,status:'pending',requested_at:requested,expires_at:expires};
  let user={id:'u1',identity_verification_provider:'socure',identity_provider_reference:superseded?'different':'e1',
    identity_verification_status:'pending',account_state:'provisional'};
  let reads=0,archives=0;
  const sdk={auth:{me:async()=>auth?{id:'admin',role:auth}:null},asServiceRole:{entities:{
    SocureIdentityVerification:{filter:async()=>[{...row}],get:async()=>({...row}),update:async(id,patch)=>{row={...row,...patch};}},
    User:{get:async()=>({...user}),update:async(id,patch)=>{user={...user,...patch};}}
  }}};
  const {handler}=await loadBackend('base44/functions/reconcileOverdueSocureIdentities/entry.ts',{
    'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
    '../../shared/socureIdentity.ts':{identityWebhookConfig:()=>({}),readIdentityEvaluation:async()=>{reads++;if(unavailable)throw Error('provider unavailable');return provider;}},
    '../../shared/socureKycPolicy.js':policy,
    '../../shared/kycEvidenceArchive.ts':{encryptComplianceJson:async()=>{archives++;return {ciphertext:'encrypted',iv:'iv',sha256:'hash'};}},
    '../../shared/achAuthorization.js':{complianceRetentionUntil:()=>new Date(Date.now()+86400000).toISOString()},
    '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>lock,releaseUserWalletLock:async()=>{}}
  });
  const response=await handler(new Request('https://test.invalid',{method:'POST'}));
  return {response,summary:await response.json(),row,user,reads,archives};
}
let x=await run();assert.equal(x.row.status,'expired');assert.equal(x.user.identity_verification_status,'expired');assert.equal(x.summary.expired,1);
x=await run({provider:accepted});assert.equal(x.row.status,'verified');assert.equal(x.user.account_state,'verified');assert.equal(x.archives,1);
x=await run({provider:{...accepted,eval_end_time:new Date(Date.now()-60000).toISOString()}});assert.equal(x.row.status,'review_required');assert.equal(x.user.account_state,'provisional');
x=await run({provider:{...accepted,id:'wrong'}});assert.equal(x.row.status,'pending');assert.equal(x.summary.failed,1);
x=await run({provider:{...accepted,decision:'REJECT'}});assert.equal(x.row.status,'rejected');assert.equal(x.user.account_state,'provisional');
x=await run({unavailable:true});assert.equal(x.row.status,'pending');assert.equal(x.user.identity_verification_status,'pending');
x=await run({provider:{...accepted,eval_status:'evaluation_running'}});assert.equal(x.row.status,'pending');
x=await run({superseded:true});assert.equal(x.summary.superseded,1);assert.equal(x.reads,0);
x=await run({lock:false});assert.equal(x.summary.busy,1);assert.equal(x.reads,0);
x=await run({auth:'user'});assert.equal(x.response.status,403);assert.equal(x.reads,0);
x=await run({auth:null});assert.equal(x.response.status,401);assert.equal(x.reads,0);
console.log('Overdue Socure reconciliation: paused, completed, late, rejected, correlation, outage, supersession, lock and authorization checks passed.');
