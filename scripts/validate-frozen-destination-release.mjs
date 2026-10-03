import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadBackend} from './helpers/load-backend.mjs';
import {buildWithdrawalBody} from '../base44/shared/seamlessAchPure.js';

// Exact production identities are fixtures only. No live SDK, network, secrets,
// function invocation or workflow access exists in this dependency-injected harness.
const TX='6ac0ffa858d9771269dfa357';
const KEY='a317b26b-5ca3-4a31-ab7d-1c625c596a72';
const SOURCE='ace8a1d7-1c71-488d-ac4d-461012b5eb13';
const OP='6ac0ffaa03a7057211df88c7';
const REASON='withdrawal_destination_deleted';
let db, ops, posts, gets, writes, mode, failure, admin, ledgerLocked;
const matches=(row,q)=>Object.entries(q||{}).every(([k,v])=>v&&typeof v==='object'&&v.$in?v.$in.includes(row[k]):row[k]===v);
const entities=new Proxy({}, {get:(_,name)=>({
  filter:async(q={},sort='created_date',limit=500)=>{
    if(name==='SeamlessBankAccount'&&mode==='entity-timeout'&&q.source_id)throw Error('mock read timeout');
    if(name==='SeamlessBankAccount'&&mode==='entity-page'&&q.source_id)return {items:db[name],has_more:false};
    const rows=(db[name]||[]).filter(row=>matches(row,q));
    const key=sort.replace(/^-/,''),direction=sort.startsWith('-')?-1:1;
    return structuredClone(rows.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))*direction).slice(0,limit));
  },
  get:async id=>structuredClone((db[name]||[]).find(row=>row.id===id)||null),
  create:async row=>{
    const id=name==='WalletTransaction'&&row.type==='withdrawal'?TX:name==='SeamlessOperation'?OP:name+'-'+(db[name]||[]).length;
    const next={...structuredClone(row),id,created_date:new Date().toISOString()};(db[name]||=[]).push(next);writes.push({name,id,patch:row});return structuredClone(next);
  },
  update:async(id,patch)=>{
    if(failure==='audit-released'&&name==='SeamlessOperation'&&patch.status==='released'){failure='';throw Error('mock audit interruption');}
    if(failure==='tx-failed'&&name==='WalletTransaction'&&patch.status==='failed'){failure='';throw Error('mock transaction interruption');}
    const row=(db[name]||[]).find(row=>row.id===id);assert.ok(row,'updated fixture must exist');Object.assign(row,structuredClone(patch));writes.push({name,id,patch:structuredClone(patch)});return structuredClone(row);
  },
  bulkCreate:async rows=>{
    if(failure==='journal-entries'&&rows.some(row=>row.trigger_event==='withdrawal_reservation_release')){failure='';throw Error('mock journal interruption');}
    for(const row of rows)(db[name]||=[]).push({...structuredClone(row),id:name+'-'+db[name].length});
  },
})});
const client={auth:{me:async()=>({id:'fixture-user',role:admin?'admin':'user',identity_verified:true})},asServiceRole:{entities}};
const save=async(user,key,value)=>{
  if(failure==='redis-released'&&value.state==='released'){failure='';throw Error('mock operation interruption');}
  ops[key]=structuredClone(value);return structuredClone(value);
};
const {exports:{postLedgerLegs}}=await loadBackend('base44/shared/ledger.ts',{
  './fundingProvenance.ts':{prepareFundingCommit:async()=>({})},
  './ledgerPagination.ts':{allLedgerRows:async(entity,q)=>entity.filter(q)},
  './integrationEvents.ts':{recordIntegrationEvent:async()=>{}},
  './seamlessAtomicStore.ts':{acquireLedgerLock:async()=>{if(ledgerLocked)return false;ledgerLocked=true;return true;},releaseLedgerLock:async()=>{ledgerLocked=false;},refreshLedgerLock:async()=>true,getUserWalletBarrier:async()=>''},
});
const {exports:{settleQueuedWithdrawalFee}}=await loadBackend('base44/shared/queuedWithdrawalFee.ts',{'./ledger.ts':{postLedgerLegs}});
const provider=async(method,path)=>{
  assert.equal(method,'GET','preflight is read-only');gets.push(path);
  if(path==='/account')return {user_id:'merchant'};
  if(path==='/funding-source/user/:merchant')return {success:true,list:[{id:'merchant-balance',user_id:'merchant',bank:'Balance',status:'verified'}]};
  assert.equal(path,'/funding-source/user/:customer');
  if(mode==='provider-timeout')throw Object.assign(Error('mock timeout'),{status:503});
  if(mode==='provider-failed')return {success:false,list:[]};
  if(mode==='provider-page')return {success:true,list:{data:[]}};
  if(mode==='provider-empty')return {success:true,list:[]};
  if(mode==='provider-malformed')return {success:true,list:[{status:'verified'}]};
  const row={id:SOURCE,user_id:'customer',bank:'Acorns',status:' VERIFIED ',is_primary:'false'};
  if(mode==='provider-deleted')row.status='deleted';
  if(mode==='provider-reconnect')row.status='login-required';
  return {success:true,list:mode==='provider-conflict'?[row,{...row,status:'deleted'}]:[row,{id:'new-primary',user_id:'customer',status:'verified',is_primary:true}]};
};
const {exports:verified}=await loadBackend('base44/shared/verifiedWithdrawalBody.ts',{'./seamlessAch.ts':{PATH_ACCOUNT:'/account',buildWithdrawalBody,seamlessRequest:provider}});
const deps={
  'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>client},
  '../../shared/fundingProvenance.ts':{walletFundingSummary:async()=>({available_to_play:10})},
  '../../shared/withdrawalQueue.ts':{estimateQueuedWithdrawal:async()=>({withdrawal_estimated_arrival:'2026-10-07T13:30:00Z'}),queuedWithdrawalReady:async()=>true},
  '../../shared/queuedWithdrawalFee.ts':{settleQueuedWithdrawalFee},
  '../../shared/withdrawalRequestedEmail.ts':{sendWithdrawalRequestedEmail:async()=>({sent:true})},
  '../../shared/seamlessFundingConfig.ts':{seamlessWithdrawalsEnabled:()=>true,seamlessRtpPayoutsEnabled:()=>false},
  '../../shared/complianceEvidence.ts':{extendComplianceEvidenceRetention:async()=>({})},
  '../../shared/identityEligibility.js':{hasVerifiedIdentity:async()=>true},
  '../../shared/legalName.ts':{legalNameFromUser:()=>({fullName:'Fixture Player'})},
  '../../shared/seamlessAch.ts':{seamlessConfig:()=>({}),seamlessBaseUrl:()=>'',PATH_CHECK_SEND:'/send',SEAMLESS_PROVIDER_KEY:'seamless_ach'},
  '../../shared/ledger.ts':{postLedgerLegs},
  '../../shared/integrationEvents.ts':{recordIntegrationEvent:async()=>{}},
  '../../shared/withdrawalLimits.js':{MAX_WITHDRAWAL_AMOUNT:1100,withdrawalCents:value=>Math.round(value*100)},
  '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>true,releaseUserWalletLock:async()=>{},claimWithdrawalOperation:async(user,key,amount)=>ops[key]||{amount,state:'new'},saveWithdrawalOperation:save},
  '../../shared/verifiedWithdrawalBody.ts':verified,
  '../../shared/limitedWithdrawal.ts':{sendLimitedWithdrawal:async()=>{posts++;return {check_id:'mock-payment'};}},
};
const {handler,exports:{releaseWithdrawalReservation}}=await loadBackend('base44/functions/submitSeamlessWithdrawal/entry.ts',deps);
const call=async body=>{const res=await handler(new Request('https://isolated.invalid',{method:'POST',body:JSON.stringify(body)}));return {status:res.status,data:await res.json()};};
const tx=()=>db.WalletTransaction.find(row=>row.id===TX),audit=()=>db.SeamlessOperation.find(row=>row.id===OP);
async function reset(){
  db={User:[{id:'fixture-user',identity_verified:true}],Wallet:[{id:'wallet',user_id:'fixture-user',available_balance:10,held_balance:0}],
    LedgerEntry:[{id:'seed',launch_epoch:2,user_id:'fixture-user',ledger_account:'user_account',available_delta:10,held_delta:0}],LedgerJournalBatch:[],SystemLedgerAccount:[],WalletTransaction:[],SeamlessOperation:[],IntegrationReference:[],
    SeamlessPaymentProfile:[{user_id:'fixture-user',provider_user_id:'customer'}],SeamlessBankAccount:[{id:'local-bank',user_id:'fixture-user',source_id:SOURCE,provider_user_id:'customer',status:'verified',is_primary:true}]};
  ops={};posts=0;gets=[];writes=[];mode='match';failure='';admin=false;ledgerLocked=false;
  const queued=await call({amount:10,idempotencyKey:KEY});assert.equal(queued.status,200);assert.equal(queued.data.status,'queued');assert.equal(posts,0);
  assert.equal(tx().funding_source_id,SOURCE);assert.equal(tx().id,TX);assert.equal(audit().idempotency_key,KEY);assert.equal(audit().status,'reserved');
  assert.equal(db.Wallet[0].available_balance,0);assert.equal(db.Wallet[0].held_balance,10);admin=true;
}
const input={base44:client,userId:'fixture-user',providerUserId:'customer',sourceId:SOURCE,name:'Fixture Player',amount:10,label:'chessbet-withdrawal-'+TX};

// Actual positional-array query, exact ID alias/status normalization, and no
// primary selection in either local or provider records. Direct preflight: zero POST.
await reset();db.SeamlessBankAccount[0].is_primary=false;
let body=await verified.buildVerifiedWithdrawalBody(input);
assert.equal(body.account,'merchant-balance');assert.equal(body.recipient,'customer');assert.equal(body.amount,'10.00');assert.equal(posts,0);
assert.equal((await call({queuedTransactionId:TX})).status,200);assert.equal(posts,1);
await call({queuedTransactionId:TX});assert.equal(posts,1,'successful payout is never resent');

// Primitive number/string equality uses the exact source, never Boolean(primary).
const {exports:{buildVerifiedWithdrawalBody:primitiveBody}}=await loadBackend('base44/shared/verifiedWithdrawalBody.ts',{'./seamlessAch.ts':{PATH_ACCOUNT:'/account',buildWithdrawalBody,seamlessRequest:async(method,path)=>{
  assert.equal(method,'GET');if(path==='/account')return {user_id:88};
  return {success:true,list:path.endsWith(':88')?[{id:99,user_id:'88',bank:' Balance ',status:' VERIFIED '}]:[{source_id:123,user_id:77,status:' added ',is_primary:0}]};
}}});
assert.equal((await primitiveBody({providerUserId:' 77 ',sourceId:' 123 ',name:'Fixture',amount:10,label:'test'})).account,'99');
assert.equal(posts,1,'primitive preflight did not submit');

for(const [testMode,reason] of [['provider-deleted',REASON],['provider-reconnect','withdrawal_destination_reconnect_required'],['provider-conflict','withdrawal_destination_multiple_primary'],['local-deleted',REASON],['local-reconnect','withdrawal_destination_reconnect_required'],['local-conflict','withdrawal_destination_multiple_primary']]){
  await reset();mode=testMode;
  if(testMode==='local-deleted')db.SeamlessBankAccount[0].status='deleted';
  if(testMode==='local-reconnect')db.SeamlessBankAccount[0].status='verification_expired';
  if(testMode==='local-conflict')db.SeamlessBankAccount.push({...db.SeamlessBankAccount[0],id:'conflict',status:'deleted'});
  const result=await call({queuedTransactionId:TX});assert.equal(result.status,400,testMode);assert.equal(result.data.withdrawal_reason,reason);
  assert.equal(posts,0);assert.equal(tx().status,'failed');assert.equal(tx().integration_status,'failed');assert.equal(tx().withdrawal_request_status,'failed');
  assert.equal(audit().status,'released');assert.equal(audit().last_error_code,reason);assert.equal(audit().last_error_message,result.data.error);
  assert.equal(audit().completed_at,tx().processed_at);assert.ok(Date.parse(audit().updated_at)>=Date.parse(audit().completed_at));
  assert.equal(ops[KEY].state,'released');assert.equal(ops[KEY].last_error_code,reason);assert.equal(ops[KEY].last_error_message,result.data.error);
  assert.equal(db.Wallet[0].available_balance,10);assert.equal(db.Wallet[0].held_balance,0);
  const complete=audit().completed_at,processed=tx().processed_at,entries=db.LedgerEntry.length;
  await call({queuedTransactionId:TX});await call({queuedTransactionId:TX});
  assert.equal(posts,0);assert.equal(db.LedgerEntry.length,entries);assert.equal(db.Wallet[0].available_balance,10);assert.equal(db.Wallet[0].held_balance,0);
  assert.equal(audit().status,'released');assert.equal(audit().completed_at,complete);assert.equal(tx().processed_at,processed);
  assert.equal(db.LedgerJournalBatch.filter(row=>row.trigger_event==='withdrawal_reservation_release').length,1);
  const failedIndex=writes.findIndex(write=>write.name==='WalletTransaction'&&write.id===TX&&write.patch.status==='failed');
  const releasedIndex=writes.findIndex(write=>write.name==='SeamlessOperation'&&write.patch.status==='released');
  assert.ok(releasedIndex>=0&&releasedIndex<failedIndex,'wallet failure is exposed only after durable operation release');
}

for(const testMode of ['provider-timeout','provider-failed','provider-page','provider-empty','provider-malformed','entity-page','entity-timeout','local-missing']){
  await reset();mode=testMode;if(testMode==='local-missing')db.SeamlessBankAccount=[];
  const result=await call({queuedTransactionId:TX});assert.equal(result.status,202,testMode);assert.equal(result.data.status,'uncertain');assert.equal(posts,0);
  assert.equal(tx().withdrawal_request_status,'review_required');assert.equal(audit().status,'uncertain');assert.equal(ops[KEY].state,'uncertain');
  assert.equal(db.Wallet[0].held_balance,10);assert.equal(db.Wallet[0].available_balance,0);
  assert.equal(db.LedgerJournalBatch.filter(row=>row.trigger_event==='withdrawal_reservation_release').length,0);
  await call({queuedTransactionId:TX});assert.equal(posts,0);
}
assert.equal(verified.isDefinitePreflightRejection({withdrawalReason:'withdrawal_destination_missing',withdrawalIndeterminate:true}),false);

// Recovery at every post-intent boundary runs the real immutable journal,
// never another reservation or provider request, even if Redis retention is lost.
for(const boundary of ['journal-entries','redis-released','audit-released','tx-failed']){
  await reset();mode='provider-deleted';failure=boundary;
  assert.equal((await call({queuedTransactionId:TX})).status,503,boundary);assert.equal(posts,0);
  assert.equal(audit().release_ledger_group_id,'seamless:withdrawal:release:'+TX);delete ops[KEY];
  const result=await call({queuedTransactionId:TX});assert.equal(result.status,400,boundary);assert.equal(posts,0);
  assert.equal(tx().status,'failed');assert.equal(audit().status,'released');assert.equal(ops[KEY].state,'released');
  assert.equal(db.Wallet[0].available_balance,10);assert.equal(db.Wallet[0].held_balance,0);
  assert.equal(db.LedgerJournalBatch.filter(row=>row.trigger_event==='withdrawal_reservation_release').length,1);
  assert.equal(db.LedgerJournalBatch.filter(row=>row.trigger_event==='withdrawal_request_reservation').length,1);
}

// No downgrade of durable submitted, processing, successful, ambiguous or
// review evidence; no mutation at all when a release conflicts with it.
for(const protectedStatus of ['submitted','processing','completed','succeeded','uncertain','ambiguous','review_required']){
  await reset();audit().status=protectedStatus;
  const before=JSON.stringify(db),count=writes.length;
  await assert.rejects(()=>releaseWithdrawalReservation(client,structuredClone(tx()),10,REASON,'Safe message',ops[KEY]),/withdrawal_release_evidence_conflict/);
  assert.equal(JSON.stringify(db),before);assert.equal(writes.length,count);assert.equal(posts,0);
  delete ops[KEY];
  assert.equal((await call({queuedTransactionId:TX})).status,202);
  assert.equal(JSON.stringify(db),before,'handler also preserves protected evidence after cache loss');assert.equal(writes.length,count);assert.equal(posts,0);
}
await reset();audit().provider_reference_id='provider-evidence';
await assert.rejects(()=>releaseWithdrawalReservation(client,structuredClone(tx()),10,REASON,'Safe message',ops[KEY]),/withdrawal_release_evidence_conflict/);assert.equal(posts,0);
await reset();tx().status='review_required';tx().integration_status='uncertain';
await assert.rejects(()=>releaseWithdrawalReservation(client,structuredClone(tx()),10,REASON,'Safe message',ops[KEY]),/withdrawal_release_evidence_conflict/);assert.equal(db.Wallet[0].held_balance,10);assert.equal(posts,0);

// Audit identity is owner-scoped: another user's reused key is untouched.
await reset();db.SeamlessOperation.push({...audit(),id:'other-user',user_id:'other-user',status:'submitted',provider_reference_id:'other-payment'});
mode='provider-deleted';assert.equal((await call({queuedTransactionId:TX})).status,400);assert.equal(db.SeamlessOperation.find(row=>row.id==='other-user').status,'submitted');assert.equal(posts,0);
const schema=JSON.parse(await readFile(new URL('../base44/entities/SeamlessOperation.jsonc',import.meta.url),'utf8'));
for(const field of ['release_ledger_group_id','last_error_message','completed_at'])assert.ok(schema.properties[field]);
assert.equal(schema.rls.create,false);assert.equal(schema.rls.update,false);assert.equal(schema.rls.delete,false);
console.log('Frozen production destination and operation-release consistency: exact-source lookup, plain arrays, primitive normalization, zero-POST failures, real journal idempotency, interruption recovery, protected evidence and owner scope passed.');