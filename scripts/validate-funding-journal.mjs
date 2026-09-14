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
  if(file.endsWith('/seamlessAtomicStore.ts'))text='export const acquireLedgerLock=async()=>globalThis.acquire(); export const releaseLedgerLock=async()=>globalThis.release(); export const refreshLedgerLock=async()=>true; export const getUserWalletBarrier=async()=>"";';
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
console.log('Funding journal integration: '+checks+' assertions passed.');
