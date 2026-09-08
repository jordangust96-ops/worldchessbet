import assert from 'node:assert/strict';
import { loadBackend } from './helpers/load-backend.mjs';

const user = {id:'u1',identity_verification_provider:'socure',identity_provider_reference:'e1',identity_verification_status:'verified',account_state:'verified'};
const record = {id:'v1',user_id:'u1',provider_evaluation_id:'e1',status:'verified',provider_decision:'ACCEPT',provider_report_ciphertext:'fixture'};
async function run(caller, u=user, v=record, events=[]) {
  const updates=[], flags=[], reads=[];
  const sdk={auth:{me:async()=>caller},asServiceRole:{entities:{
    User:{filter:async()=>{reads.push('users');return [u];},update:async(id,value)=>updates.push(value)},
    SocureIdentityVerification:{filter:async(query)=>{assert.equal(query.user_id,u.id);return v?[v]:[];}},
    IntegrationEvent:{filter:async()=>events,create:async()=>{}},
    IntegrityFlag:{create:async(value)=>flags.push(value)}
  }}};
  const {handler}=await loadBackend('base44/functions/reconcileIdentityVerification/entry.ts',{'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk}});
  const response=await handler(new Request('https://test.invalid',{method:'POST',body:'{}'}));
  return {status:response.status,updates,flags,reads};
}
for(const [caller,status] of [[null,401],[{role:'user'},403]]) {
  const r=await run(caller);assert.equal(r.status,status);assert.equal(r.reads.length,0);
}
const admin={role:'admin'};
assert.equal((await run(admin)).updates.length,0,'trusted matching snapshot unchanged');
for(const v of [null,{...record,status:'rejected'},{...record,user_id:'another'},{...record,provider_evaluation_id:'wrong'},{...record,provider_report_ciphertext:''}]) {
  const r=await run(admin,user,v);assert.equal(r.updates[0].account_state,'provisional');assert.notEqual(r.updates[0].identity_verification_status,'verified');assert.equal(r.flags.length,1);
}
const pending={...user,identity_verification_status:'pending',account_state:'provisional'};
assert.equal((await run(admin,pending,record)).updates[0].account_state,'verified','trusted accepted record repairs pending snapshot');
assert.equal((await run(admin,pending,{...record,provider_report_ciphertext:''})).updates.length,0,'untrusted record never promotes');
for(const state of ['suspended','closed']) {
  assert.equal((await run(admin,{...pending,account_state:state},record)).updates[0].account_state,state,'promotion preserves restrictions');
  assert.equal((await run(admin,{...user,account_state:state},null)).updates[0].account_state,undefined,'downgrade preserves restrictions');
}
console.log('Identity reconciliation handler checks passed: auth, owner binding, evidence, drift and restricted accounts; no live records.');
