import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
let role='admin',writes=[],calls=[],invocations=0,rows=[],response={success:true,list:[]};
const client={auth:{me:async()=>({role})},functions:{invoke:async()=>{invocations++;throw Error('unexpected payout retry');}},asServiceRole:{entities:{
 WalletTransaction:{update:async(id,patch)=>{writes.push({id,patch});}},
 SeamlessOperation:{filter:async()=>[{id:'audit',last_error_code:'provider_rejected_http_400'}],update:async(id,patch)=>writes.push({id,patch})}
}}};
const {handler}=await loadBackend('base44/functions/processQueuedWithdrawals/entry.ts',{
 'npm:@base44/sdk@0.8.48':{createClientFromRequest:()=>client},
 '../../shared/withdrawalRequestedEmail.ts':{sendWithdrawalRequestedEmail:async()=>({})},
 '../../shared/queuedWithdrawalFee.ts':{settleQueuedWithdrawalFee:async()=>{}},
 '../../shared/seamlessLedgerTransitions.ts':{refundWithdrawalFee:async()=>{}},
 '../../shared/ledgerPagination.ts':{allLedgerRows:async()=>rows},
 '../../shared/seamlessAtomicStore.ts':{inspectPayoutCapacityStore:async()=>({check_available:true})},
 '../../shared/verifiedWithdrawalBody.ts':{buildVerifiedWithdrawalBody:async()=>{throw Error('unexpected routing');}},
 '../../shared/legalName.ts':{legalNameFromUser:()=>null},
 '../../shared/seamlessAch.ts':{seamlessRequest:async(method,path)=>{assert.equal(method,'GET');calls.push(path);return response;}}
});
async function call(input){const r=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(input)}));return {status:r.status,data:await r.json()};}
const old=new Date(Date.now()-600000).toISOString();
rows=[{id:'stuck',withdrawal_requested_at:old,withdrawal_provider_attempt_at:old,withdrawal_request_status:'processing',integration_status:'submitting',status:'pending'}];
role='user';assert.equal((await call({inspectOnly:true,inspectPayments:true,transactionId:'stuck'})).status,403);assert.equal(calls.length,0);
role='admin';
let r=await call({inspectOnly:true,inspectPayments:true,transactionId:'stuck'});
assert.equal(r.data.complete,true);assert.deepEqual(r.data.matches,[]);assert.equal(writes.length,0);assert.equal(invocations,0);
response={success:true,list:{data:[{check_id:'check',label:'chessbet-withdrawal-stuck',amount:9.25,status:'pending',direction:'outgoing'}],total:1,last_page:1}};
r=await call({inspectOnly:true,inspectPayments:true,transactionId:'stuck'});
assert.equal(r.data.matches[0].check_id,'check');assert.equal(writes.length,0);
response={success:false,list:[]};
assert.equal((await call({inspectOnly:true,inspectPayments:true,transactionId:'stuck'})).status,502);
r=await call({});
assert.equal(r.data.review_required,1);assert.equal(invocations,0);
assert.equal(writes[0].patch.status,'review_required');assert.equal(writes[0].patch.integration_status,'uncertain');
assert.equal(writes[1].patch.last_error_code,'provider_rejected_http_400');
assert.ok(writes.every(x=>!('amount' in x.patch)&&!('available_balance' in x.patch)&&!('held_balance' in x.patch)));
writes=[];rows[0].withdrawal_provider_attempt_at=new Date().toISOString();
assert.equal((await call({})).data.review_required,0);assert.equal(writes.length,0);
rows[0].withdrawal_provider_attempt_at=old;rows[0].integration_status='submitted';
assert.equal((await call({})).data.review_required,0);assert.equal(writes.length,0);
console.log('Withdrawal interruption checks passed: authorization, read-only provider lookup, failure handling, stale review classification, no payout retry or balance mutation.');
