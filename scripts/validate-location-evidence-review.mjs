import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
import * as gates from '../base44/shared/jurisdictionGates.js';
for(const test of [{caller:null,status:401},{caller:{role:'user'},status:403},{caller:{role:'admin'},repair:false},{caller:{role:'admin'},repair:true},{caller:{role:'admin'},repair:true,quality:true}]){
let writes=0,audits=0;
const user={id:'u',role:'user',jurisdiction_status:'approved',jurisdiction_last_verified_at:'2026-09-12T12:00:00Z'};
const row={id:'e',user_id:'u',verification_result:'approved',verified_at:user.jurisdiction_last_verified_at,country_confidence:99,subdivision_confidence:test.quality?99:10,accuracy_radius_km:test.quality?5:1000,vpn_or_proxy_detected:false};
const sdk={auth:{me:async()=>test.caller},asServiceRole:{entities:{User:{get:async()=>({...user}),update:async(id,p)=>{writes++;Object.assign(user,p)}},JurisdictionVerificationLog:{filter:async()=>[row],create:async()=>{audits++}}}}};
const {handler}=await loadBackend('base44/functions/reviewLocationEvidence/entry.ts',{'npm:@base44/sdk@0.8.48':{createClientFromRequest:()=>sdk},'../../shared/jurisdictionGates.js':gates,'../../shared/walletOnboardingLocation.ts':{walletOnboardingLocation:async()=>({allowed:!!test.quality})}});
const res=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({userIds:['u'],repair:test.repair})}));
assert.equal(res.status,test.status||200);assert.equal(writes,test.repair&&!test.quality?1:0);assert.equal(audits,writes);
}
console.log('Evidence repair checks passed: authorization, read-only default, weak approval repair, strong approval preserved.');
