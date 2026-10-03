import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
import {applyWebhookEvent,mapTransactionStatus,applyFundingSourceEvent,normalizeProviderEventTime} from '../base44/shared/seamlessAchPure.js';
const invoke=async(handler,input={})=>{const r=await handler(new Request('https://isolated.invalid',{method:'POST',body:JSON.stringify(input)}));return {status:r.status,data:await r.json()};};
let posts=0,invocations=0;
const neverSubmit=async()=>{posts++;throw Error('Unexpected provider POST');};
const old=new Date(Date.now()-3600000).toISOString();

// Execute the real reconciliation handler, not merely its pure reducer.
for(const providerStatus of ['pending','processing','hold','timeout','ambiguous']){
 posts=0;
 const tx={id:'tx',user_id:'a',type:'withdrawal',amount:9.25,status:'pending',integration_status:'submitted',created_date:old};
 const trackers=[];let transitions=0,gets=0;
 const entity={
  WalletTransaction:{filter:async q=>q.integration_status===tx.integration_status?[structuredClone(tx)]:[],get:async()=>structuredClone(tx),update:async(id,p)=>Object.assign(tx,p)},
  IntegrationReference:{filter:async()=>[{id:'ref',external_reference_id:'check',wallet_transaction_id:'tx'}]},
  SeamlessStatusReconciliation:{list:async()=>trackers,create:async p=>{const r={id:'tracker',...p};trackers.push(r);return r;},update:async(id,p)=>Object.assign(trackers[0],p)}
 };
 const client={auth:{me:async()=>({role:'admin'})},asServiceRole:{entities:entity},functions:{invoke:neverSubmit}};
 const {handler}=await loadBackend('base44/functions/reconcile-seamless-ach-statuses/entry.ts',{
  'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>client},
  '../../shared/seamlessAch.ts':{applyWebhookEvent,mapTransactionStatus,buildCheckLookupPath:id=>'/check/'+id,seamlessConfig:()=>{},SEAMLESS_PROVIDER_KEY:'seamless_ach',seamlessRequest:async method=>{if(method==='POST')return neverSubmit();assert.equal(method,'GET');gets++;if(providerStatus==='timeout')throw {status:503};return providerStatus==='ambiguous'?{}:{check:{check_id:'check',status:providerStatus}};}},
  '../../shared/seamlessLedgerTransitions.ts':{recoverFeeDepositState:async(b,t)=>t,postSeamlessSettlement:async()=>{transitions++;},releaseSeamlessWithdrawal:async()=>{transitions++;},reverseSeamlessSettlement:async()=>{transitions++;}},
  '../../shared/integrationEvents.ts':{recordIntegrationEvent:async()=>{}},
  '../../shared/depositReconciliation.ts':{flagDepositReview:async()=>{}},
  '../../shared/seamlessAtomicStore.ts':{claimWebhookEvent:async()=>({claim:'owned'}),finishWebhookEvent:async()=>{}}
 });
 const r=await invoke(handler);
 assert.equal(r.status,200);assert.equal(gets,1);assert.equal(transitions,0);assert.equal(posts,0,'read-only '+providerStatus+' reconciliation: zero POSTs');assert.equal(tx.status,'pending');
 await invoke(handler);assert.equal(posts,0,'duplicate reconciliation: zero POSTs');assert.equal(gets,1,'backoff prevents duplicate read');
}

// The scheduler sees already-submitted or uncertain requests and never resubmits.
posts=0;invocations=0;
let rows=[{id:'unknown',status:'review_required',integration_status:'uncertain',withdrawal_request_status:'review_required',withdrawal_requested_at:old},{id:'sent',status:'pending',integration_status:'submitted',withdrawal_request_status:'processing',withdrawal_requested_at:old}];
const schedulerClient={auth:{me:async()=>({role:'admin'})},functions:{invoke:async()=>{invocations++;return neverSubmit();}},asServiceRole:{entities:{}}};
const {handler:scheduler}=await loadBackend('base44/functions/processQueuedWithdrawals/entry.ts',{
 'npm:@base44/sdk@0.8.48':{createClientFromRequest:()=>schedulerClient},
 '../../shared/withdrawalRequestedEmail.ts':{sendWithdrawalRequestedEmail:async()=>({})},
 '../../shared/queuedWithdrawalFee.ts':{settleQueuedWithdrawalFee:async()=>{}},
 '../../shared/seamlessLedgerTransitions.ts':{refundWithdrawalFee:async()=>{}},
 '../../shared/ledgerPagination.ts':{allLedgerRows:async()=>rows},
 '../../shared/seamlessAtomicStore.ts':{inspectPayoutCapacityStore:async()=>({check_available:true})},
 '../../shared/verifiedWithdrawalBody.ts':{buildVerifiedWithdrawalBody:async()=>({amount:9.25})},
 '../../shared/legalName.ts':{legalNameFromUser:()=>({fullName:'Test Player'})},
 '../../shared/seamlessAch.ts':{seamlessRequest:async method=>{if(method==='POST')return neverSubmit();assert.equal(method,'GET');return {success:true,list:[]};}}
});
for(let i=0;i<2;i++){assert.equal((await invoke(scheduler)).status,200);assert.equal(invocations,0);assert.equal(posts,0,'duplicate scheduler: zero provider POSTs');}
for(const input of [{inspectOnly:true},{inspectOnly:true,inspectPayments:true,transactionId:'unknown'}]){const r=await invoke(scheduler,input);assert.equal(r.status,200);assert.equal(invocations,0);assert.equal(posts,0,'read-only queue inspection: zero POSTs');}

// Raw bank.account.login.required must actually reach the funding-source handler.
posts=0;let applied=0;
const bank={id:'bank',source_id:'source',user_id:'a',profile_id:'profile',provider_user_id:'customer',status:'verified'};
const entities={SeamlessPaymentProfile:{filter:async()=>[{id:'profile',user_id:'a',provider_user_id:'customer',provider_key:'seamless_ach'}]},SeamlessBankAccount:{filter:async()=>[bank],update:async(id,p)=>{applied++;Object.assign(bank,p);return bank;}},User:{get:async()=>({id:'a'})}};
let complete=false;
const {handler:webhook}=await loadBackend('base44/functions/seamlessAchWebhook/entry.ts',{
 'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>({asServiceRole:{entities}})},
 '../../shared/seamlessAch.ts':{verifySeamlessWebhookAuth:()=>true,webhookIdempotencyKey:()=> 'event',applyWebhookEvent,mapTransactionStatus,applyFundingSourceEvent,normalizeProviderEventTime,userSafeTransferFailureReason:()=>'',SEAMLESS_PROVIDER_KEY:'seamless_ach',seamlessRequest:neverSubmit},
 '../../shared/seamlessLedgerTransitions.ts':{recoverFeeDepositState:async(b,t)=>t,postSeamlessSettlement:neverSubmit,releaseSeamlessWithdrawal:neverSubmit,reverseSeamlessSettlement:neverSubmit},
 '../../shared/integrationEvents.ts':{recordIntegrationEvent:async()=>{}},
 '../../shared/depositReconciliation.ts':{flagDepositReview:async()=>{}},
 '../../shared/seamlessAtomicStore.ts':{claimWebhookEvent:async()=>({claim:complete?'completed':'owned'}),finishWebhookEvent:async()=>{complete=true;}}
});
const event={event:'bank.account.login.required',source_id:'source',user_id:'customer',event_id:'event',timestamp:new Date().toISOString()};
const first=await invoke(webhook,event);assert.equal(first.status,200);assert.equal(first.data.bank_status,'login_required');assert.equal(applied,1);assert.equal(posts,0);
const duplicate=await invoke(webhook,event);assert.equal(duplicate.status,200);assert.equal(duplicate.data.deduplicated,true);assert.equal(applied,1);assert.equal(posts,0,'duplicate funding webhook: zero POSTs');
console.log('Actual reconciliation, queue/scheduler and funding-webhook no-POST boundaries passed.');