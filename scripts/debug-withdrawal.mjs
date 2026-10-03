import {loadBackend} from './helpers/load-backend.mjs';
import fs from 'node:fs';
import ts from 'typescript';
import path from 'node:path';
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
let db={Wallet:[{id:'wa',user_id:'a',available_balance:0,held_balance:9.25}],LedgerEntry:[{id:'seed',launch_epoch:2,user_id:'a',ledger_account:'user_account',wallet_transaction_id:'d',available_delta:0,held_delta:9.25}],LedgerJournalBatch:[],SystemLedgerAccount:[],WalletTransaction:[{id:'d',user_id:'a',type:'deposit',amount:9.25,status:'completed',deposit_hold_status:'released',deposit_withdrawal_status:'held',deposit_release_at:new Date(Date.now()+2*86400000).toISOString(),provider_last_status:'Processed'}],User:[{id:'a',identity_verified:true}],SeamlessBankAccount:[{id:'bank',user_id:'a',source_id:'bank1',status:'verified',is_primary:true}],SeamlessPaymentProfile:[{user_id:'a',provider_user_id:'customer'}]};
let ops={},providerCalls=0,outcome='accepted';
const matches=(row,q)=>Object.entries(q).every(([k,v])=>{if(v&&typeof v==='object'){if(v.$in)return Array.isArray(row[k])?row[k].some(x=>v.$in.includes(x)):v.$in.includes(row[k]);if(v.$gt!==undefined)return row[k]>v.$gt;}return row[k]===v;});
const entities=new Proxy({}, {get:(_,name)=>({
  filter:async(q={},sort='created_date',limit=500,skip=0)=>{const rows=(db[name]||[]).filter(r=>matches(r,q));const desc=sort.startsWith('-'),key=desc?sort.slice(1):sort;rows.sort((a,b)=>a[key]===b[key]?0:((a[key]??0)<(b[key]??0)?-1:1)*(desc?-1:1));return structuredClone(rows.slice(skip,skip+limit));},
  get:async(id)=>structuredClone((db[name]||[]).find(r=>r.id===id)),
  create:async(row)=>{const next={created_date:new Date().toISOString(),...structuredClone(row),id:name+'-'+(db[name]||[]).length};(db[name]||=[]).push(next);return structuredClone(next);},
  update:async(id,patch)=>{const row=db[name].find(r=>r.id===id);Object.assign(row,patch);return structuredClone(row);},
})});
const base44={asServiceRole:{entities}};
const {estimateQueuedWithdrawal,queuedWithdrawalReady}=await import(await moduleUrl(path.join(root,'base44/shared/withdrawalQueue.ts')));
const {settleQueuedWithdrawalFee}=await import(await moduleUrl(path.join(root,'base44/shared/queuedWithdrawalFee.ts')));
let caller={id:'a',role:'user'};
base44.auth={me:async()=>caller};
const {handler}=await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts',{
  'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>base44},
  '../../shared/fundingProvenance.ts':{walletFundingSummary},
  '../../shared/withdrawalQueue.ts':{estimateQueuedWithdrawal,queuedWithdrawalReady},
  '../../shared/queuedWithdrawalFee.ts':{settleQueuedWithdrawalFee},
  '../../shared/withdrawalRequestedEmail.ts':{sendWithdrawalRequestedEmail:async(b,tx)=>({sent:true})},
  '../../shared/seamlessFundingConfig.ts':{seamlessWithdrawalsEnabled:()=>true,seamlessRtpPayoutsEnabled:()=>false},
  '../../shared/complianceEvidence.ts':{extendComplianceEvidenceRetention:async()=>({})},
  '../../shared/identityEligibility.js':{hasVerifiedIdentity:async(b,u)=>u.identity_verified!==false},
  '../../shared/legalName.ts':{legalNameFromUser:()=>({fullName:'Test Player'})},
  '../../shared/seamlessAch.ts':{seamlessConfig:()=>({}),seamlessBaseUrl:()=>'',buildWithdrawalBody:x=>x,PATH_CHECK_SEND:'/send',SEAMLESS_PROVIDER_KEY:'seamless_ach'},
  '../../shared/ledger.ts':{postLedgerLegs},
  '../../shared/integrationEvents.ts':{recordIntegrationEvent:async()=>{}},
  '../../shared/withdrawalLimits.js':{MAX_WITHDRAWAL_AMOUNT:1100,withdrawalCents:amount=>Math.round(amount*100)},
  '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>true,releaseUserWalletLock:async()=>{},claimWithdrawalOperation:async(id,key,amount)=>ops[key]||{amount,state:'new'},saveWithdrawalOperation:async(id,key,value)=>ops[key]=structuredClone(value)},
  '../../shared/verifiedWithdrawalBody.ts':{buildVerifiedWithdrawalBody:async x=>x,DEFINITE_DESTINATION_REASONS:new Set(['withdrawal_destination_changed']),isDefinitePreflightRejection:e=>e?.withdrawalReason==='withdrawal_destination_changed'},
  '../../shared/limitedWithdrawal.ts':{sendLimitedWithdrawal:async()=>{providerCalls++;return {check_id:'payout'};}}
});
async function call(body,admin=false){caller=admin?{id:'admin',role:'admin'}:{id:'a',role:'user'};const response=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};}
// Create + queue the withdrawal
const r1=await call({amount:9.25,idempotencyKey:'queued-request-12345'});
console.log('FIRST CALL STATUS:',r1.status,'DATA:',JSON.stringify(r1.data));
const tx=()=>db.WalletTransaction.find(t=>t.type==='withdrawal');
// Mature
db.WalletTransaction.find(t=>t.id==='d').deposit_release_at='2026-01-01T00:00:00Z';
tx().withdrawal_process_after='2026-01-01T00:00:00Z';
globalThis.providerResponse={check:{check_id:'d',amount:9.25,status:'processed'}};
// Submit
const result=await call({queuedTransactionId:tx().id},true);
console.log('STATUS:',result.status);
console.log('DATA:',JSON.stringify(result.data,null,2));
console.log('TX:',JSON.stringify(tx(),null,2).slice(0,500));