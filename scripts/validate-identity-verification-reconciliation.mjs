import assert from 'node:assert/strict';
import { loadBackend } from './helpers/load-backend.mjs';
import * as eligibility from '../base44/shared/identityEligibility.js';
const legacy={id:'u1',account_state:'verified',identity_verification_status:'verified',identity_verification_provider:'seamless_ach_plaid',identity_provider_reference:'source-1'};
async function run(caller,current=legacy,evidence=null,lock=true){
 const updates=[];let reads=0;let releases=0;
 const sdk={auth:{me:async()=>caller},asServiceRole:{entities:{
 User:{list:async()=>{reads++;return [current];},get:async()=>current,update:async(id,patch)=>updates.push(patch)},
 SocureIdentityVerification:{filter:async()=>evidence?[evidence]:[]}
 }}};
 const {handler}=await loadBackend('base44/functions/reconcileIdentityVerification/entry.ts',{
 'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
 '../../shared/identityEligibility.js':eligibility,
 '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>lock,releaseUserWalletLock:async()=>{releases++;}}
 });
 const response=await handler(new Request('https://test.invalid',{method:'POST',body:'{}'}));
 return {status:response.status,updates,reads,releases};
}
for(const [caller,status] of [[null,401],[{role:'user'},403]]){
 const r=await run(caller);assert.equal(r.status,status);assert.equal(r.reads,0);
}
const admin={role:'admin'};
let r=await run(admin);assert.equal(r.status,200);assert.equal(r.updates[0].identity_verification_status,'not_started');
assert.equal(r.updates[0].account_state,'provisional');assert.equal(r.releases,1);
r=await run(admin,{...legacy,account_state:'suspended'});assert.ok(!('account_state' in r.updates[0]));
r=await run(admin,legacy,null,false);assert.equal(r.updates.length,0,'in-flight identity update is not disturbed');
const verified={...legacy,identity_legal_name:'Test Player',identity_verification_provider:'socure',identity_provider_reference:'eval',identity_policy_version:eligibility.KYC_POLICY_VERSION,identity_age_verified:true,identity_age_over_21:true};
const row={user_id:'u1',verified_legal_name:'Test Player',provider_evaluation_id:'eval',workflow:'consumer_onboarding',environment:'production',policy_version:eligibility.KYC_POLICY_VERSION,
status:'verified',provider_decision:'ACCEPT',age_verified:true,age_over_21:true,webhook_event_id:'event',provider_report_ciphertext:'cipher',provider_report_sha256:'hash',verified_valid_until:'2099-01-01T00:00:00Z'};
assert.equal((await run(admin,verified,row)).updates.length,0);
assert.equal((await run(admin,verified,{...row,verified_valid_until:'2020-01-01T00:00:00Z'})).updates.length,1);
console.log('KYC reconciliation: authorization, legacy revocation, valid evidence, expiry, restrictions and shared lock passed.');

