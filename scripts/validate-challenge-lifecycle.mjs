import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';

// Runs the actual challenge and journal modules with isolated in-memory
// storage, locks and provider adapters. Never calls Base44, Redis or a bank.
const root = process.cwd();
const clone = value => structuredClone(value);
let assertions = 0;
const check = (value, message) => { assertions++; assert.ok(value,message); };
const equal = (value, expected, message) => { assertions++; assert.deepEqual(value,expected,message); };
function matches(row,query) {
  return Object.entries(query || {}).every(([key,value])=>{
    if(key==='$or')return value.some(q=>matches(row,q));
    if(key==='$and')return value.every(q=>matches(row,q));
    const actual=row[key];
    if(value && typeof value==='object' && !Array.isArray(value))return Object.entries(value).every(([op,v])=>
      op==='$in'?v.includes(actual):op==='$nin'?!v.includes(actual):op==='$ne'?actual!==v:
      op==='$gte'?actual>=v:op==='$lte'?actual<=v:op==='$gt'?actual>v:op==='$lt'?actual<v:
      op==='$exists'?(actual!==undefined)===v:false);
    return actual===value;
  });
}
function fixture() {
  const state={now:Date.parse('2026-09-14T12:00:00Z'),serial:0,db:{},fail:null,location:true,errors:[],lookups:0,creates:[]};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[state.now]));} static now(){return state.now;} }
  const table=name=>state.db[name] ||= [];
  const entities=new Proxy({}, {get:(_,name)=>({
    filter:async(query={},sort='',limit=500,skip=0,fields)=>{
      let rows=table(name).filter(row=>matches(row,query));
      if(sort){const reverse=sort[0]==='-';const field=reverse?sort.slice(1):sort;rows=[...rows].sort((a,b)=>String(a[field]??'').localeCompare(String(b[field]??''))*(reverse?-1:1));}
      rows=rows.slice(skip,skip+limit);
      return clone(rows.map(row=>fields?Object.fromEntries(['id',...fields].filter(k=>row[k]!==undefined).map(k=>[k,row[k]])):row));
    },
    get:async id=>{const row=table(name).find(x=>x.id===id);if(!row)throw Error(`not_found:${name}:${id}`);return clone(row);},
    create:async data=>{
      if(state.fail?.where===`${name}.create.before`){state.fail=null;throw Error('injected_before_commit');}
      const row={id:`${String(name).toLowerCase()}-${++state.serial}`,created_date:new Clock().toISOString(),...clone(data)};
      table(name).push(row);state.creates.push({name,id:row.id});
      if(state.fail?.where===`${name}.create.after`){state.fail=null;throw Error('injected_lost_response');}
      return clone(row);
    },
    update:async(id,patch)=>{
      if(state.fail?.where===`${name}.update` && (!state.fail.test || state.fail.test(id,patch))) {state.fail=null;throw Error('injected_projection_failure');}
      const row=table(name).find(x=>x.id===id);if(!row)throw Error('update_missing');Object.assign(row,clone(patch));return clone(row);
    },
    bulkCreate:async rows=>{
      const partial=state.fail?.where===`${name}.bulkCreate.partial`;
      if(partial)state.fail=null;
      const result=[];for(const data of (partial?rows.slice(0,3):rows))result.push(await entities[name].create(data));
      if(partial)throw Error('injected_partial_projection');return result;
    },
  })});
  const mutex=new Map(), barriers=new Map();
  const acquire=(key,owner)=>{if(mutex.has(key)&&mutex.get(key)!==owner)return false;mutex.set(key,owner);return true;};
  const release=(key,owner)=>{if(mutex.get(key)===owner)mutex.delete(key);};
  const atomic={
    acquireMatchLock:async(id,owner)=>acquire('m:'+id,owner),releaseMatchLock:async(id,owner)=>release('m:'+id,owner),
    acquireUserWalletLock:async(id,owner,recovery='')=>(!barriers.has(id)||barriers.get(id)===recovery)&&acquire('u:'+id,owner),
    releaseUserWalletLock:async(id,owner)=>release('u:'+id,owner),
    acquireLedgerLock:async owner=>acquire('ledger',owner),releaseLedgerLock:async owner=>release('ledger',owner),
    refreshLedgerLock:async owner=>mutex.get('ledger')===owner,
    refreshContestLocks:async(id,users,owner)=>mutex.get('m:'+id)===owner && users.every(u=>mutex.get('u:'+u)===owner),
    setChallengeWalletBarriers:async(ids,owner,id)=>{
      if(!ids.every(u=>mutex.get('u:'+u)===owner && (!barriers.has(u)||barriers.get(u)===id)))return false;
      for(const u of ids)barriers.set(u,id);return true;
    },
    clearChallengeWalletBarriers:async(ids,id)=>{
      for(const u of ids) {
        if(barriers.get(u)===id)barriers.delete(u);
        if(state.fail?.where==='barrier.clear.partial') {state.fail=null;throw Error('injected_partial_barrier_clear');}
      }
    },
    getUserWalletBarrier:async id=>barriers.get(id)||'',takeChallengeRateLimit:async()=>true,
  };
  const cache=new Map();
  let makeSdk;
  function load(relative) {
    const file=path.resolve(root,relative);
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};const result={exports:module.exports,handler:null};cache.set(file,result);
    let source=fs.readFileSync(file,'utf8');
    // Test the complete endpoint while leaving deployment disabled until QA completes.
    if(file.endsWith('/manageChallenge/entry.ts'))source=source.replace('const IMPLEMENTATION_ENABLED = false;','const IMPLEMENTATION_ENABLED = true;');
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const req=specifier=>{
      if(specifier.startsWith('npm:@base44/sdk'))return {createClientFromRequest:r=>makeSdk(r.headers.get('x-test-user')||'p1')};
      const resolved=path.resolve(path.dirname(file),specifier);
      if(resolved.endsWith('/seamlessAtomicStore.ts'))return atomic;
      if(resolved.endsWith('/seamlessFundingConfig.ts'))return {paidContestsEnabled:()=>true};
      if(resolved.endsWith('/identityEligibility.js'))return {hasVerifiedIdentity:async(sdk,user)=>!!user && (await sdk.asServiceRole.entities.User.get(user.id)).verified===true};
      if(resolved.endsWith('/matchLocation.ts'))return {
        verifyMatchLocation:async(r,m)=>{state.lookups++;return {status:state.location?'approved':'blocked',reason:'location denied'};},
        getMatchLocationReadiness:async()=>({ready:state.location,requiredUserIds:state.location?[]:['p2']}),
        matchLocationRequiredResponse:r=>Response.json({action:'match_location_required',requiredUserIds:r.requiredUserIds},{status:403}),
      };
      if(resolved.endsWith('/runContestEligibility.ts'))return {runContestEligibility:async()=>Response.json({eligible:true})};
      return load(resolved).exports;
    };
    vm.runInNewContext(compiled,{module,exports:module.exports,require:req,Date:Clock,Request,Response,Headers,URL,AbortSignal,
      TextEncoder,TextDecoder,Map,Set,crypto:crypto.webcrypto,console:{error:(...x)=>state.errors.push(x),log:()=>{}},
      setInterval:()=>1,clearInterval:()=>{},setTimeout:fn=>{fn();return 1;},clearTimeout:()=>{},
      Deno:{env:{get:()=>undefined},serve:handler=>{result.handler=handler;}},
    },{filename:file});
    result.exports=module.exports;return result;
  }
  makeSdk=id=>({auth:{me:async()=>clone(table('User').find(u=>u.id===id)||null)},
    asServiceRole:{entities,integrations:{Core:{SendEmail:async()=>({sent:true})}}},
    functions:{invoke:async(name,payload)=>{
      const response=await load(`base44/functions/${name}/entry.ts`).handler(new Request('https://example.invalid',{method:'POST',headers:{'x-test-user':id,'user-agent':'test-browser'},body:JSON.stringify(payload)}));
      const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error),{response:{status:response.status,data}});return {data};
    }},
  });
  for(const id of ['p1','p2','p3','p4']){
    table('User').push({id,verified:true,account_state:'verified',mfa_bypass:true,chess_com_username:id,withdrawal_hold:false});
    table('Wallet').push({id:'wallet-'+id,user_id:id,balance:100,available_balance:100,held_balance:0,total_balance:100});
    table('SeamlessBankAccount').push({id:'bank-'+id,user_id:id,status:'verified',source_id:'source-'+id});
    table('LedgerEntry').push({id:'seed-'+id,launch_epoch:2,user_id:id,ledger_account:'user_account',ledger_group_id:'seed:'+id,
      ledger_leg_index:0,credit_amount:100,debit_amount:0,available_delta:100,held_delta:0,total_deposited_delta:100});
  }
  const api=load('base44/shared/challengeLifecycle.ts').exports;
  const policy=load('base44/shared/challengePolicy.js').exports;
  const access=load('base44/shared/challengeAccess.ts').exports;
  const user=id=>clone(table('User').find(u=>u.id===id));
  const sdk=makeSdk('p1');
  const request=new Request('https://example.invalid',{method:'POST',headers:{'user-agent':'test-browser'},body:'{}'});
  const consent={agree:true,entryAmount:25,serviceFee:2};
  const get=id=>clone(table('Match').find(m=>m.id===id));
  const balance=(id,amount)=>{
    Object.assign(table('Wallet').find(w=>w.user_id===id),{available_balance:amount,balance:amount,total_balance:amount});
    Object.assign(table('LedgerEntry').find(e=>e.id==='seed-'+id),{credit_amount:amount,available_delta:amount,total_deposited_delta:amount});
  };
  const create=async(key='creation_key_123456')=>{
    const r=await api.createChallenge(sdk,user('p1'),{entryAmount:25,requestKey:key});return get(r.match.id);
  };
  const authorize=async m=>{await api.authorizeChallenge(request,sdk,user('p1'),m,consent);return get(m.id);};
  return {state,db:state.db,table,api,policy,access,sdk,makeSdk,atomic,barriers,mutex,load,user,request,consent,get,balance,create,authorize};
}
async function rejected(work,code){let failure;try{await work();}catch(error){failure=error;}check(failure,`Expected rejection ${code}`);if(code)equal(failure.code,code);}

// Nonfinancial invitation creation works without a funded or verified wallet.
{
  const f=fixture();f.balance('p1',0);f.table('User')[0].verified=false;
  const m=await f.create();equal(m.status,'searching');equal(m.player2_id,undefined);equal(f.table('WalletTransaction').length,0);equal(f.table('LedgerJournalBatch').length,0);
  const replay=await f.create();equal(replay.id,m.id);equal(f.table('Match').length,1);
  await rejected(()=>f.api.createChallenge(f.sdk,f.user('p1'),{entryAmount:26,requestKey:'creation_key_123456'}),'request_conflict');
  const serialized=f.policy.publicChallenge(m,'Player');check(!('player1_id' in serialized));check(!('challenge_claimant_id' in serialized));
}
for(const issue of ['unfunded','pending_only','identity','bank','hold','busy','fee_short','creator_unfunded','expired','self','location','consent']){
  const f=fixture();let m=await f.authorize(await f.create());
  if(issue==='unfunded'||issue==='pending_only')f.balance('p2',0);
  if(issue==='pending_only')f.table('Wallet').find(w=>w.user_id==='p2').held_balance=100;
  if(issue==='fee_short')f.balance('p2',25);
  if(issue==='identity')f.table('User').find(u=>u.id==='p2').verified=false;
  if(issue==='bank')f.db.SeamlessBankAccount=f.table('SeamlessBankAccount').filter(x=>x.user_id!=='p2');
  if(issue==='hold')f.table('User').find(u=>u.id==='p2').withdrawal_hold=true;
  if(issue==='busy')f.table('Match').push({id:'other',launch_epoch:2,player1_id:'p2',status:'in_progress'});
  if(issue==='creator_unfunded')f.balance('p1',0);
  if(issue==='expired')f.state.now+=86400001;
  if(issue==='location')f.state.location=false;
  const user=f.user(issue==='self'?'p1':'p2');
  await rejected(()=>f.api.acceptChallenge(f.request,f.sdk,user,m,issue==='consent'?{...f.consent,agree:false}:f.consent));
  equal(f.table('WalletTransaction').length,0,issue);equal(f.table('LedgerJournalBatch').length,0,issue);
  equal(f.get(m.id).player2_id,undefined,issue);equal(f.barriers.size,0,issue);
}
// Concurrent final acceptances: one opponent, both financial sides, one journal.
{
  const f=fixture();const m=await f.authorize(await f.create());
  const attempts=await Promise.allSettled(Array.from({length:20},(_,i)=>f.api.acceptChallenge(f.request,f.sdk,f.user(i%2?'p2':'p3'),m,f.consent)));
  equal(attempts.filter(x=>x.status==='fulfilled'&&x.value.accepted).length,1);
  const committed=f.get(m.id);check(['p2','p3'].includes(committed.player2_id));equal(committed.status,'preparing');
  equal(f.table('LedgerJournalBatch').length,1);equal(f.table('LedgerJournalBatch')[0].leg_count,8);equal(f.table('WalletTransaction').length,4);
  const winnerWallet=f.table('Wallet').find(w=>w.user_id===committed.player2_id);equal(winnerWallet.available_balance,73);equal(winnerWallet.held_balance,27);
  const replay=await f.api.acceptChallenge(f.request,f.sdk,f.user(committed.player2_id),committed,f.consent);check(replay.replay);equal(f.table('LedgerJournalBatch').length,1);
  equal(f.barriers.size,0);
  await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);equal(f.table('Game').length,0,'Funding alone cannot start a game');
}
// Crash boundaries: before/after journal commit, partial leg materialization,
// wallet projection failure, and Match projection failure.
for(const where of ['LedgerJournalBatch.create.before','LedgerJournalBatch.create.after','LedgerEntry.bulkCreate.partial','Wallet.update','Match.update']){
  const f=fixture();let m=await f.authorize(await f.create());
  f.state.fail={where,...(where==='Match.update'?{test:(_id,patch)=>patch.status==='preparing'}:{})};
  const result=await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);check(result.processing,where);
  check(f.barriers.size===2,`Both wallets protected during uncertain ${where}`);
  check(!await f.atomic.acquireUserWalletLock('p1','other-operation'),`No spending stale balance after ${where}`);
  if(where==='LedgerJournalBatch.create.before'){
    equal(f.table('LedgerJournalBatch').length,0);f.state.now+=181000;
    await f.api.recoverChallenge(f.sdk,m.id);equal(f.get(m.id).status,'searching');equal(f.get(m.id).player2_id,undefined);equal(f.table('WalletTransaction').length,0);
  }else{
    await f.api.recoverChallenge(f.sdk,m.id);m=f.get(m.id);equal(m.status,'preparing');equal(m.player2_id,'p2');
    equal(f.table('LedgerJournalBatch').length,1);equal(f.table('WalletTransaction').length,4);
    equal(f.table('LedgerEntry').filter(e=>e.ledger_group_id===f.policy.reservationGroup(m)).length,8);
    equal(f.table('Wallet').find(w=>w.user_id==='p1').available_balance,73);
  }
  equal(f.barriers.size,0,where);
}
// A no-show releases BOTH entries and fees once; no revenue recognized.
{
  const f=fixture();const m=await f.authorize(await f.create());await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);
  f.state.now+=121000;await f.api.recoverChallenge(f.sdk,m.id);await f.api.recoverChallenge(f.sdk,m.id);
  equal(f.get(m.id).status,'cancelled');equal(f.table('LedgerJournalBatch').length,2);equal(f.table('WalletTransaction').length,8);
  for(const id of ['p1','p2']){const wallet=f.table('Wallet').find(w=>w.user_id===id);equal(wallet.available_balance,100);equal(wallet.held_balance,0);}
  check(!f.table('LedgerEntry').some(e=>e.ledger_account==='platform_revenue'));equal(f.barriers.size,0);
}
// Explicit readiness on two devices, direct-start refusal, and same game/clock.
{
  const f=fixture();const m=await f.authorize(await f.create());await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);
  const ready=f.get(m.id);f.table('Match').find(x=>x.id===m.id).status='both_ready';
  await assert.rejects(()=>f.makeSdk('p2').functions.invoke('getOrCreateGame',{matchId:m.id}));assertions++;
  f.table('Match').find(x=>x.id===m.id).status='preparing';
  const emptyHeartbeat=await f.api.readyChallenge(f.request,f.sdk,f.user('p1'),m.id,{action:'heartbeat',visible:true});check(emptyHeartbeat.needsReady);
  await f.api.readyChallenge(f.request,f.sdk,f.user('p1'),m.id,{action:'ready'});
  await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);equal(f.table('Game').length,0);
  await f.api.readyChallenge(f.request,f.sdk,f.user('p2'),m.id,{action:'ready'});
  const hidden=await f.api.readyChallenge(f.request,f.sdk,f.user('p2'),m.id,{action:'heartbeat',visible:false});check(hidden.needsReady);
  const started=await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);equal(started.match.status,'in_progress');equal(f.table('Game').length,1);
  equal(f.table('Game')[0].white_time_ms,300000);equal(f.table('Game')[0].black_time_ms,300000);
  await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);equal(f.table('Game').length,1);
  await rejected(()=>f.api.cancelChallenge(f.sdk,f.user('p1'),m.id),'already_started');equal(f.table('LedgerJournalBatch').length,1);
}
// Another OPEN link is not a conflict; one creator still cannot enter two games.
{
  const f=fixture();const a=await f.authorize(await f.create('creation_key_first111'));const b=await f.authorize(await f.create('creation_key_second22'));
  const results=await Promise.allSettled([f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),a,f.consent),f.api.acceptChallenge(f.request,f.sdk,f.user('p3'),b,f.consent)]);
  equal(results.filter(r=>r.status==='fulfilled'&&r.value.accepted).length,1);equal(f.table('LedgerJournalBatch').length,1);
  equal(f.table('Match').filter(m=>m.status==='searching').length,1);
}
// Endpoint authorization, public preview, private serialization, and no writes on invalid MFA.
{
  const f=fixture();const m=await f.create();
  const response=await f.makeSdk('unknown').functions.invoke('manageChallenge',{action:'view',inviteCode:m.invite_code});
  equal(response.data.challenge.entryAmount,25);equal(response.data.participant,false);check(!('email' in response.data.challenge));
  f.table('User').find(u=>u.id==='p2').mfa_bypass=false;
  await assert.rejects(()=>f.makeSdk('p2').functions.invoke('manageChallenge',{action:'accept',inviteCode:m.invite_code,...f.consent}));assertions++;
  equal(f.table('LedgerJournalBatch').length,0);
  await rejected(()=>f.api.cancelChallenge(f.sdk,f.user('p3'),m.id),'forbidden');
  const serializer=f.load('base44/functions/manageChallenge/entry.ts').exports.safeChallengeMatch;
  const safe=serializer({...m,start_operation_id:'SECRET',challenge_claimant_id:'PRIVATE',challenge_target_id:'PRIVATE'});
  check(!('start_operation_id'in safe));check(!('challenge_claimant_id'in safe));check(!('challenge_target_id'in safe));
}
// A partial barrier clear remains visibly recoverable, including when the
// financial projection and participant assignment already succeeded.
for(const phase of ['reservation','release']) {
  const f=fixture();const m=await f.authorize(await f.create());
  if(phase==='release')await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);
  f.state.fail={where:'barrier.clear.partial'};
  if(phase==='reservation') {
    const result=await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);check(result.processing);
    equal(f.get(m.id).challenge_operation_state,'reserving');
  } else {
    await assert.rejects(()=>f.api.cancelChallenge(f.sdk,f.user('p1'),m.id));assertions++;
    equal(f.get(m.id).challenge_operation_state,'releasing');
  }
  equal(f.barriers.size,1);
  await f.api.recoverChallenge(f.sdk,m.id);equal(f.barriers.size,0);
  equal(f.get(m.id).challenge_operation_state,phase==='reservation'?'committed':'released');
  equal(f.table('LedgerJournalBatch').length,phase==='reservation'?1:2);
  equal(f.table('WalletTransaction').length,phase==='reservation'?4:8);
}
// A lost final match write resumes the already-created five-minute game.
{
  const f=fixture();const m=await f.authorize(await f.create());await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);
  await f.api.readyChallenge(f.request,f.sdk,f.user('p1'),m.id,{action:'ready'});
  await f.api.readyChallenge(f.request,f.sdk,f.user('p2'),m.id,{action:'ready'});
  f.state.fail={where:'Match.update',test:(_id,patch)=>patch.status==='in_progress'};
  await assert.rejects(()=>f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id));assertions++;
  equal(f.table('Game').length,1);const anchor=f.table('Game')[0].turn_started_at;
  f.state.now+=35000;
  const recovered=await f.api.finalizeChallengeStart(f.sdk,f.user('p2'),m.id);
  equal(recovered.match.status,'in_progress');equal(f.table('Game').length,1);equal(f.table('Game')[0].turn_started_at,anchor);
}
// A restricted rematch is not claimable by an unrelated funded link holder.
{
  const f=fixture();f.table('Match').push({id:'prior',launch_epoch:2,status:'completed',player1_id:'p1',player2_id:'p2'});
  const made=await f.api.createChallenge(f.sdk,f.user('p1'),{entryAmount:25,requestKey:'rematch_request_12345',rematchOf:'prior'});
  const m=await f.authorize(f.get(made.match.id));equal(m.challenge_target_id,'p2');
  await rejected(()=>f.api.acceptChallenge(f.request,f.sdk,f.user('p3'),m,f.consent),'different_opponent');
  equal(f.table('LedgerJournalBatch').length,0);equal(f.get(m.id).player2_id,undefined);
}
for(const fee of [null,undefined,'2',NaN,-1,2.001]) {
  const f=fixture();const m=await f.create();const state=await f.access.inspectChallengePlayer(f.sdk,'p2',{...m,platform_service_fee:fee});
  equal(state.ready,false);equal(state.code,'invalid_terms');
}
console.log(`Challenge lifecycle: ${assertions} assertions passed. Actual lifecycle/journal code; isolated providers, storage and locks; no live money movement.`);
