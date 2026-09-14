import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
import fs from 'node:fs';
import ts from 'typescript';
import path from 'node:path';
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const bad=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const root=process.cwd(), urls=new Map();
async function moduleUrl(file) {
  if(urls.has(file))return urls.get(file);
  let text=fs.readFileSync(file,'utf8');
  if(file.endsWith('/seamlessAch.ts'))text='export const buildCheckLookupPath=id=>id; export const seamlessRequest=async()=>globalThis.providerResponse;';
  if(file.endsWith('/depositReconciliation.ts'))text='export const requireVerifiedDeposit=async()=>null; export const postDepositFeePassThrough=async()=>{}; export const flagDepositReview=async()=>{}; export const depositProviderReference=async(b,tx)=>tx.id;';
  if(file.endsWith('/seamlessAtomicStore.ts'))text='export const acquireLedgerLock=async()=>globalThis.acquire(); export const releaseLedgerLock=async()=>globalThis.release(); export const refreshLedgerLock=async()=>true; export const getUserWalletBarrier=async()=>""; export const claimWebhookEvent=async()=>({claim:"owned"}); export const finishWebhookEvent=async()=>{};';
  if(file.endsWith('/integrationEvents.ts'))text='export const recordIntegrationEvent=async()=>{};';
  for(const m of [...text.matchAll(/from ['"](\.[^'"]+)['"]/g)])text=text.replace(m[0],'from '+JSON.stringify(await moduleUrl(path.resolve(path.dirname(file),m[1]))));
  text=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const url='data:text/javascript;base64,'+Buffer.from(text).toString('base64');
  urls.set(file,url);return url;
}
globalThis.Deno={env:{get:()=>undefined}};
let locked=false;
globalThis.acquire=()=>{if(locked)return false;locked=true;return true;};
globalThis.release=()=>{locked=false;};
const {postLedgerLegs}=await import(await moduleUrl(path.join(root,'base44/shared/ledger.ts')));
const {walletFundingSummary}=await import(await moduleUrl(path.join(root,'base44/shared/fundingProvenance.ts')));
let db={Wallet:[{id:'wa',user_id:'a',available_balance:10,held_balance:10}],LedgerEntry:[
{id:'ea',launch_epoch:2,user_id:'a',ledger_account:'user_account',available_delta:10,held_delta:0},
{id:'eh',launch_epoch:2,user_id:'a',ledger_account:'user_account',wallet_transaction_id:'d',available_delta:0,held_delta:10},
],LedgerJournalBatch:[],SystemLedgerAccount:[],WalletTransaction:[{id:'d',user_id:'a',type:'deposit',amount:10,status:'completed',deposit_hold_status:'released',deposit_withdrawal_status:'held',deposit_release_at:'2099-01-01T00:00:00Z',provider_last_status:'Processed'}]};
let failEntries=false;
const matches=(row,q)=>Object.entries(q).every(([k,v])=>{
 if(v && typeof v==='object'){
   if(v.$in)return Array.isArray(row[k])?row[k].some(x=>v.$in.includes(x)):v.$in.includes(row[k]);
   if(v.$gt!==undefined)return row[k]>v.$gt;
 }
 return row[k]===v;
});
const entities=new Proxy({}, {get:(_,name)=>({
 filter:async(q={},sort='created_date',limit=500,skip=0)=>{
  const rows=(db[name]||[]).filter(r=>matches(r,q));
  const desc=sort.startsWith('-'),key=desc?sort.slice(1):sort;
  rows.sort((a,b)=>a[key]===b[key]?0:((a[key]??0)<(b[key]??0)?-1:1)*(desc?-1:1));
  return structuredClone(rows.slice(skip,skip+limit));
 },
 get:async(id)=>structuredClone((db[name]||[]).find(r=>r.id===id)),
 create:async(row)=>{const next={created_date:new Date().toISOString(),...structuredClone(row),id:name+'-'+(db[name]||[]).length};(db[name]||=[]).push(next);return structuredClone(next);},
 update:async(id,patch)=>{const row=db[name].find(r=>r.id===id);Object.assign(row,patch);return structuredClone(row);},
 bulkCreate:async(rows)=>{if(failEntries){failEntries=false;throw new Error('simulated_materialization_failure');}for(const row of rows)(db[name]||=[]).push({...structuredClone(row),id:name+'-'+db[name].length});}
})});
const base44={asServiceRole:{entities}};

const {estimateQueuedWithdrawal,queuedWithdrawalReady}=await import(await moduleUrl(path.join(root,'base44/shared/withdrawalQueue.ts')));
const {settleQueuedWithdrawalFee}=await import(await moduleUrl(path.join(root,'base44/shared/queuedWithdrawalFee.ts')));
const {releaseSeamlessWithdrawal}=await import(await moduleUrl(path.join(root,'base44/shared/seamlessLedgerTransitions.ts')));
let caller={id:'a',role:'user'},userLocked=false,ops={},providerCalls=0,outcome='accepted',emails=new Set();
base44.auth={me:async()=>caller};
const {handler}=await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts',{
 'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>base44},
 '../../shared/fundingProvenance.ts':{walletFundingSummary},
 '../../shared/withdrawalQueue.ts':{estimateQueuedWithdrawal,queuedWithdrawalReady},
 '../../shared/queuedWithdrawalFee.ts':{settleQueuedWithdrawalFee},
 '../../shared/withdrawalRequestedEmail.ts':{sendWithdrawalRequestedEmail:async(b,tx)=>{emails.add(tx.id);return {sent:true};}},
 '../../shared/seamlessFundingConfig.ts':{seamlessWithdrawalsEnabled:()=>true,seamlessRtpPayoutsEnabled:()=>false},
 '../../shared/complianceEvidence.ts':{extendComplianceEvidenceRetention:async()=>({})},
 '../../shared/identityEligibility.js':{hasVerifiedIdentity:async(b,u)=>u.identity_verified!==false},
 '../../shared/legalName.ts':{legalNameFromUser:()=>({fullName:'Test Player'})},
 '../../shared/seamlessAch.ts':{seamlessConfig:()=>({}),seamlessBaseUrl:()=>'',buildWithdrawalBody:x=>x,PATH_CHECK_SEND:'/send',SEAMLESS_PROVIDER_KEY:'seamless_ach'},
 '../../shared/ledger.ts':{postLedgerLegs},
 '../../shared/integrationEvents.ts':{recordIntegrationEvent:async()=>{}},
 '../../shared/withdrawalLimits.js':{MAX_WITHDRAWAL_AMOUNT:1100,withdrawalCents:amount=>{if(amount<=0||amount>1100||Math.abs(amount*100-Math.round(amount*100))>.00001)throw Error('invalid_amount');return Math.round(amount*100);}},
 '../../shared/seamlessAtomicStore.ts':{
 acquireUserWalletLock:async()=>{if(userLocked)return false;userLocked=true;return true;},releaseUserWalletLock:async()=>{userLocked=false;},
 claimWithdrawalOperation:async(id,key,amount)=>ops[key]||{amount,state:'new'},saveWithdrawalOperation:async(id,key,value)=>ops[key]=structuredClone(value)},
 '../../shared/limitedWithdrawal.ts':{sendLimitedWithdrawal:async()=>{providerCalls++;if(outcome==='capacity')throw {status:429,payoutCapacity:true};if(outcome==='reject')throw {status:400};if(outcome==='timeout')throw {status:503};return {check_id:'payout'};}}
});
async function reset(){
 db={Wallet:[{id:'wa',user_id:'a',available_balance:0,held_balance:9.25}],LedgerEntry:[{id:'seed',launch_epoch:2,user_id:'a',ledger_account:'user_account',wallet_transaction_id:'d',available_delta:0,held_delta:9.25}],LedgerJournalBatch:[],SystemLedgerAccount:[],WalletTransaction:[{id:'d',user_id:'a',type:'deposit',amount:9.25,status:'completed',deposit_hold_status:'released',deposit_withdrawal_status:'held',deposit_release_at:new Date(Date.now()+2*86400000).toISOString(),provider_last_status:'Processed'}],User:[{id:'a',identity_verified:true}],SeamlessBankAccount:[{id:'bank',user_id:'a',source_id:'bank1',status:'verified',is_primary:true}],SeamlessPaymentProfile:[{user_id:'a',provider_user_id:'customer'}]};
 ops={};providerCalls=0;outcome='accepted';emails=new Set();caller={id:'a',role:'user'};
 await postLedgerLegs(base44,{groupId:'deposit-release',walletTransactionId:'d',actor:'system',triggerEvent:'deposit_availability_release',updateTransactions:false,legs:[{ledgerAccount:'user_account',userId:'a',debit:9.25,credit:9.25,availableDelta:9.25,heldDelta:-9.25,transactionType:'investigation_hold_release'}]});
}
async function call(body,admin=false){caller=admin?{id:'admin',role:'admin'}:{id:'a',role:'user'};const response=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};}
const request=(amount=9.25,key='queued-request-12345')=>call({amount,idempotencyKey:key});
const tx=()=>db.WalletTransaction.find(t=>t.type==='withdrawal');
async function mature(){
 db.WalletTransaction.find(t=>t.id==='d').deposit_release_at='2026-01-01T00:00:00Z';
 tx().withdrawal_process_after='2026-01-01T00:00:00Z';
 globalThis.providerResponse={check:{check_id:'d',amount:9.25,status:'processed'}};
}
await reset();
let result=await request();eq(result.status,200);eq(result.data.status,'queued');eq(providerCalls,0);eq(db.Wallet[0].available_balance,0);eq(db.Wallet[0].held_balance,9.25);eq(emails.size,1);eq(tx().withdrawal_request_fee,0);assert.ok(Date.parse(result.data.estimated_arrival)>Date.parse(db.WalletTransaction[0].deposit_release_at));checks++;
await request();eq(db.WalletTransaction.filter(t=>t.type==='withdrawal').length,1);eq(db.Wallet[0].held_balance,9.25);eq(providerCalls,0);
eq((await request(1)).status,409);
await bad(()=>postLedgerLegs(base44,{groupId:'spend-reserved',actor:'user',triggerEvent:'challenge_reservation',matchId:'m',legs:[{ledgerAccount:'user_account',userId:'a',debit:1,heldDelta:1,transactionType:'match_entry'},{ledgerAccount:'contest_clearing',credit:1,transactionType:'match_entry'}]}),/negative/);
eq((await call({queuedTransactionId:tx().id})).status,403);eq(providerCalls,0);
eq((await call({queuedTransactionId:tx().id},true)).data.status,'queued');eq(providerCalls,0);
await mature();result=await call({queuedTransactionId:tx().id},true);eq(result.status,200);eq(providerCalls,1);eq(tx().integration_status,'submitted');
await call({queuedTransactionId:tx().id},true);eq(providerCalls,1);
await reset();failEntries=true;eq((await request()).status,503);eq(emails.size,0);eq(providerCalls,0);eq((await request()).status,200);eq(db.Wallet[0].available_balance,0);eq(db.Wallet[0].held_balance,9.25);eq(db.LedgerJournalBatch.filter(b=>b.trigger_event==='withdrawal_request_reservation').length,1);
await reset();await request(5);eq(db.Wallet[0].available_balance,1.75);eq(db.Wallet[0].held_balance,7.5);eq(tx().withdrawal_request_fee,2.5);eq(db.WalletTransaction.find(t=>t.type==='withdrawal_fee').status,'pending');
await mature();outcome='capacity';eq((await call({queuedTransactionId:tx().id},true)).data.status,'queued');eq(db.Wallet[0].held_balance,7.5);eq(tx().integration_status,'reserved');
outcome='reject';eq((await call({queuedTransactionId:tx().id},true)).status,400);eq(db.Wallet[0].available_balance,9.25);eq(db.Wallet[0].held_balance,0);eq(db.WalletTransaction.find(t=>t.type==='withdrawal_fee').status,'failed');
await reset();await request(5);await mature();await call({queuedTransactionId:tx().id},true);eq(db.Wallet[0].held_balance,5);eq(db.WalletTransaction.find(t=>t.type==='withdrawal_fee').status,'completed');
await releaseSeamlessWithdrawal(base44,structuredClone(tx()),5,'payout','failed','test_failure');eq(db.Wallet[0].available_balance,9.25);eq(db.Wallet[0].held_balance,0);
await releaseSeamlessWithdrawal(base44,structuredClone(tx()),5,'payout','failed','test_failure');eq(db.Wallet[0].available_balance,9.25);
await reset();await request();await mature();outcome='timeout';eq((await call({queuedTransactionId:tx().id},true)).status,202);await call({queuedTransactionId:tx().id},true);eq(providerCalls,1);eq(db.Wallet[0].available_balance,0);
await reset();await request();await mature();db.User[0].withdrawal_hold=true;eq((await call({queuedTransactionId:tx().id},true)).status,403);eq(providerCalls,0);
await reset();await request();await mature();globalThis.providerResponse.check.status='failed';eq((await call({queuedTransactionId:tx().id},true)).data.status,'queued');eq(providerCalls,0);
await reset();await request();await mature();db.SeamlessBankAccount[0].status='deleted';eq((await call({queuedTransactionId:tx().id},true)).status,400);eq(providerCalls,0);
console.log('Queued withdrawal integration: '+checks+' assertions passed; actual handler, journal, source timing, fee recovery and provider-boundary mocks.');
