import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import path from 'node:path';
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const bad=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const root=process.cwd(), urls=new Map();
async function moduleUrl(file) {
  if(urls.has(file))return urls.get(file);
  let text=fs.readFileSync(file.endsWith('/shared/ledger.ts') && fs.existsSync('scripts/funding-candidates/ledger.ts') ? 'scripts/funding-candidates/ledger.ts' : file,'utf8');
  if(file.endsWith('/shared/seamlessLedgerTransitions.ts') && fs.existsSync('scripts/funding-candidates/seamlessLedgerTransitions.ts'))text=fs.readFileSync('scripts/funding-candidates/seamlessLedgerTransitions.ts','utf8');
  if(file.endsWith('/shared/seamlessLedgerTransitions.ts'))text=text.replace('PROCESSED_PLAY_ENABLED = false','PROCESSED_PLAY_ENABLED = true');
  if(file.endsWith('/seamlessAch.ts'))text='export const buildCheckLookupPath=id=>id; export const seamlessRequest=async()=>globalThis.providerResponse;';
  if(file.endsWith('/depositReconciliation.ts'))text='export const requireVerifiedDeposit=async()=>null; export const postDepositFeePassThrough=async()=>{}; export const flagDepositReview=async()=>{}; export const depositProviderReference=async(b,tx)=>tx.id;';
  if(file.endsWith('/seamlessAtomicStore.ts'))text='export const acquireLedgerLock=async()=>globalThis.acquire(); export const releaseLedgerLock=async()=>globalThis.release(); export const refreshLedgerLock=async()=>true; export const getUserWalletBarrier=async()=>""; export const claimWebhookEvent=async()=>({claim:"owned"}); export const finishWebhookEvent=async()=>{};';
  if(file.endsWith('/integrationEvents.ts'))text='export const recordIntegrationEvent=async()=>{};';
  for(const m of [...text.matchAll(/from ['"](\.[^'"]+)['"]/g)])text=text.replace(m[0],'from '+JSON.stringify(await moduleUrl(path.resolve(path.dirname(file),m[1]))));
  text=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const url='data:text/javascript;base64,'+Buffer.from(text).toString('base64');
  urls.set(file,url);return url;
}
let locked=false;
globalThis.acquire=()=>{if(locked)return false;locked=true;return true;};
globalThis.release=()=>{locked=false;};
const {postLedgerLegs}=await import(await moduleUrl(path.join(root,'base44/shared/ledger.ts')));
const {walletFundingSummary}=await import(await moduleUrl(path.join(root,'base44/shared/fundingProvenance.ts')));
const db={Wallet:[{id:'wa',user_id:'a',available_balance:10,held_balance:10}],LedgerEntry:[
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
 create:async(row)=>{const next={...structuredClone(row),id:name+'-'+(db[name]||[]).length};(db[name]||=[]).push(next);return structuredClone(next);},
 update:async(id,patch)=>{const row=db[name].find(r=>r.id===id);Object.assign(row,patch);return structuredClone(row);},
 bulkCreate:async(rows)=>{if(failEntries){failEntries=false;throw new Error('simulated_materialization_failure');}for(const row of rows)(db[name]||=[]).push({...structuredClone(row),id:name+'-'+db[name].length});}
})});
const base44={asServiceRole:{entities}};
const release={groupId:'deposit_availability_release:d:release',walletTransactionId:'d',actor:'system',triggerEvent:'deposit_availability_release',updateTransactions:false,
legs:[{ledgerAccount:'user_account',userId:'a',debit:10,credit:10,availableDelta:10,heldDelta:-10,transactionType:'investigation_hold_release'}]};
failEntries=true;
await bad(()=>postLedgerLegs(base44,release),/simulated_materialization_failure/);
eq(db.LedgerJournalBatch.length,1);
eq(JSON.parse(db.LedgerJournalBatch[0].funding_provenance_json).users.a.available.reduce((n,l)=>n+l.cents,0),2000);
eq(db.Wallet[0].available_balance,10); // interrupted before projection
await postLedgerLegs(base44,release);
eq(db.LedgerJournalBatch.length,1);
eq(db.Wallet[0].available_balance,20);
eq((await walletFundingSummary(base44,'a')).available_to_withdraw,10);
await postLedgerLegs(base44,release);
eq(db.Wallet[0].available_balance,20);
eq(db.LedgerJournalBatch.length,1);
const withdraw=(amount,fee=0)=>({groupId:'w'+amount,walletTransactionId:'w'+amount,actor:'system',triggerEvent:'withdrawal_reservation',withdrawalFee:fee,updateTransactions:false,
legs:[{ledgerAccount:'user_account',userId:'a',debit:amount,credit:0,heldDelta:amount,transactionType:'withdrawal'},{ledgerAccount:'withdrawal_reserve',debit:0,credit:amount,transactionType:'withdrawal'}]});
await bad(()=>postLedgerLegs(base44,withdraw(11)),/ach_withdrawal_hold/);
await bad(()=>postLedgerLegs(base44,withdraw(9,2.5)),/ach_withdrawal_hold/);
eq(db.LedgerJournalBatch.length,1);
const outcomes=await Promise.allSettled([postLedgerLegs(base44,withdraw(10)),postLedgerLegs(base44,withdraw(10))]);
eq(outcomes.filter(r=>r.status==='fulfilled').length,1);
eq(db.LedgerJournalBatch.length,2);
eq(db.Wallet[0].available_balance,10);
eq((await walletFundingSummary(base44,'a')).available_to_withdraw,0);
await bad(()=>postLedgerLegs(base44,withdraw(1)),/ach_withdrawal_hold/);
eq(db.LedgerJournalBatch.length,2);
const {postSeamlessSettlement,releaseDepositAvailability,releaseDepositWithdrawal,reverseSeamlessSettlement}=await import(await moduleUrl(path.join(root,'base44/shared/seamlessLedgerTransitions.ts')));
db.Wallet.push({id:'wb',user_id:'b',available_balance:0,held_balance:0});
db.WalletTransaction.push({id:'d2',user_id:'b',type:'deposit',amount:10,status:'pending',created_date:'2026-09-14T12:00:00Z'});
globalThis.providerResponse={check:{check_id:'d2',amount:10,status:'processed'}};
const d2=()=>structuredClone(db.WalletTransaction.find(tx=>tx.id==='d2'));
await postSeamlessSettlement(base44,d2(),10,'d2','seamless_webhook_settled');
eq(db.Wallet.find(w=>w.user_id==='b').available_balance,10);
eq(d2().deposit_hold_status,'released');
eq(d2().deposit_available_email_status,'pending');
eq((await walletFundingSummary(base44,'b')).available_to_withdraw,0);
eq(await releaseDepositAvailability(base44,d2()),false);
eq(db.Wallet.find(w=>w.user_id==='b').available_balance,10);
eq(await releaseDepositWithdrawal(base44,d2()),false);
db.WalletTransaction.find(tx=>tx.id==='d2').deposit_release_at='2026-01-01T00:00:00Z';
globalThis.providerResponse={check:{check_id:'wrong',amount:10,status:'processed'}};
await bad(()=>releaseDepositWithdrawal(base44,d2()),/verification_failed/);
eq(d2().deposit_withdrawal_status,'held');
globalThis.providerResponse={check:{check_id:'d2',amount:10,status:'pending'}};
await bad(()=>releaseDepositWithdrawal(base44,d2()),/verification_failed/);
globalThis.providerResponse={check:{check_id:'d2',amount:10,status:'processed'}};
eq(await releaseDepositWithdrawal(base44,d2()),true);
eq((await walletFundingSummary(base44,'b')).available_to_withdraw,10);
await reverseSeamlessSettlement(base44,d2(),10,'d2','seamless_webhook_reversed');
eq(db.Wallet.find(w=>w.user_id==='b').available_balance,0);
eq(d2().deposit_withdrawal_status,'returned');
eq(d2().status,'reversed');
await reverseSeamlessSettlement(base44,d2(),10,'d2','seamless_webhook_reversed');
eq(db.Wallet.find(w=>w.user_id==='b').available_balance,0);
const {bankWithdrawalAt}=await import('../base44/shared/depositTiming.js');
eq(bankWithdrawalAt('2026-09-09T22:59:21.815000'),'2026-09-16T22:59:21.815Z');
eq(bankWithdrawalAt('2026-09-04T12:00:00Z'),'2026-09-14T12:00:00.000Z');
eq(bankWithdrawalAt('2026-09-13T22:00:00-04:00'),'2026-09-19T02:00:00.000Z');
eq(bankWithdrawalAt('2026-06-29T12:00:00Z'),'2026-07-06T12:00:00.000Z');
assert.throws(()=>bankWithdrawalAt('invalid'));checks++;
console.log('Funding journal integration: '+checks+' assertions passed.');
