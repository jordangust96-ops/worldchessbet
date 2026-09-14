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
      op==='$in'?(Array.isArray(actual)?actual.some(x=>v.includes(x)):v.includes(actual)):op==='$nin'?!v.includes(actual):op==='$ne'?actual!==v:
      op==='$gte'?actual>=v:op==='$lte'?actual<=v:op==='$gt'?actual>v:op==='$lt'?actual<v:
      op==='$exists'?(actual!==undefined)===v:false);
    return actual===value;
  });
}
let selectedTimeControl;
function fixture() {
  const state={now:Date.parse('2026-09-14T12:00:00Z'),serial:0,db:{},fail:null,location:true,errors:[],lookups:0,creates:[]};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[state.now]));} static now(){return state.now;} }
  const table=name=>state.db[name] ||= [];
  const entities=new Proxy({}, {get:(_,name)=>({
    filter:async(query={},sort='',limit=500,skip=0,fields)=>{
      let rows=table(name).filter(row=>matches(row,query));
      if(sort){const reverse=sort[0]==='-';const field=reverse?sort.slice(1):sort;rows=[...rows].sort((a,b)=>(typeof a[field]==='number' && typeof b[field]==='number'?a[field]-b[field]:String(a[field]??'').localeCompare(String(b[field]??'')))*(reverse?-1:1));}
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
        verifyChallengeCreationLocation:async(r,key)=>{check(r instanceof Request,'Creation receives original request');state.creationLookups=(state.creationLookups||0)+1;if(state.afterCreationLocation)state.afterCreationLocation();return {status:state.location?'approved':'blocked',reason:'location denied'};},
        verifyMatchLocation:async(r,m)=>{state.lookups++;return {status:state.location?'approved':'blocked',reason:'location denied'};},
        getMatchLocationReadiness:async()=>({ready:state.location,requiredUserIds:state.location?[]:['p2']}),
        matchLocationRequiredResponse:r=>Response.json({action:'match_location_required',requiredUserIds:r.requiredUserIds},{status:403}),
      };
      if(resolved.endsWith('/runContestEligibility.ts'))return {runContestEligibility:async()=>Response.json({eligible:true})};
      return load(resolved).exports;
    };
    vm.runInNewContext(compiled,{module,exports:module.exports,require:req,Date:Clock,Request,Response,Headers,URL,AbortSignal,
      TextEncoder,TextDecoder,Map,Set,structuredClone,crypto:crypto.webcrypto,console:{error:(...x)=>state.errors.push(x),log:()=>{}},
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
  const originalCreate=api.createChallenge;
  api.createChallenge=(sdk,u,body,req=request)=>originalCreate(sdk,u,{creationVersion:policy.CHALLENGE_CREATION_VERSION,serviceFee:load('base44/shared/platformFee.ts').exports.getPlatformServiceFee(Number(body.entryAmount)),...body},req);
  const consent={agree:true,entryAmount:25,serviceFee:2};
  const get=id=>clone(table('Match').find(m=>m.id===id));
  const balance=(id,amount)=>{
    Object.assign(table('Wallet').find(w=>w.user_id===id),{available_balance:amount,balance:amount,total_balance:amount});
    Object.assign(table('LedgerEntry').find(e=>e.id==='seed-'+id),{credit_amount:amount,available_delta:amount,total_deposited_delta:amount});
  };
  const create=async(key='creation_key_123456')=>{
    const r=await api.createChallenge(sdk,user('p1'),{entryAmount:25,requestKey:key,...(selectedTimeControl ? {timeControl:selectedTimeControl} : {})});return get(r.match.id);
  };
  const authorize=async m=>{await api.maintainCreatorPresence(request,sdk,user('p1'),m,{presenceId:'creator_presence_123456',visible:true});return get(m.id);};
  return {state,db:state.db,table,api,policy,access,sdk,makeSdk,atomic,barriers,mutex,load,user,request,consent,get,balance,create,authorize};
}
async function rejected(work,code){let failure;try{await work();}catch(error){failure=error;}check(failure,`Expected rejection ${code}`);if(code)equal(failure.code,code);}


const wallet=(f,id)=>f.table('Wallet').find(w=>w.user_id===id);
const summary=async(f,id='p1')=>(await f.makeSdk(id).functions.invoke('manageChallenge',{action:'wallet_summary'})).data;
const attest=f=>({action:'ready',presenceId:'ready_session_123456',agree:true,attestationVersion:f.policy.FAIR_PLAY_ATTESTATION_VERSION});
for(const entryAmount of [5,10,25,50,100,250,500,1000,2500]){
 const f=fixture();f.balance('p1',3000);const r=await f.api.createChallenge(f.sdk,f.user('p1'),{entryAmount,requestKey:'presets_request_12345'});
 const total=entryAmount+r.match.platform_service_fee;
 equal(wallet(f,'p1').available_balance,3000-total);equal(wallet(f,'p1').held_balance,total);
 equal(f.table('LedgerJournalBatch').length,1);equal(f.table('WalletTransaction').length,2);equal(r.match.player1_certified,false);
 equal((await summary(f)).reserved_for_matches,total);
 const replay=await f.api.createChallenge(f.sdk,f.user('p1'),{entryAmount,requestKey:'presets_request_12345'});
 equal(replay.match.id,r.match.id);equal(f.table('LedgerJournalBatch').length,1);
 await f.api.cancelChallenge(f.sdk,f.user('p1'),r.match.id);await f.api.cancelChallenge(f.sdk,f.user('p1'),r.match.id);
 equal(wallet(f,'p1').available_balance,3000);equal(wallet(f,'p1').held_balance,0);equal((await summary(f)).reserved_for_matches,0);
 equal(f.table('LedgerJournalBatch').length,2);
}
for(const publiclyListed of [false,true])for(const issue of ['unfunded','pending','fee_short','identity','bank','restricted','location','lost_funds']){
 const f=fixture();
 const expected={unfunded:'funds_required',pending:'funds_required',fee_short:'funds_required',identity:'identity_required',bank:'bank_required',restricted:'account_restricted',location:'location_required',lost_funds:'funds_required'}[issue];
 if(['unfunded','pending'].includes(issue))f.balance('p1',0);
 if(issue==='pending')Object.assign(wallet(f,'p1'),{pending_balance:1000,held_balance:1000,balance:1000,total_balance:1000});
 if(issue==='fee_short')f.balance('p1',25);
 if(issue==='identity')f.table('User')[0].verified=false;
 if(issue==='bank')f.table('SeamlessBankAccount').length=0;
 if(issue==='restricted')f.table('User')[0].account_state='suspended';
 if(issue==='location')f.state.location=false;
 if(issue==='lost_funds')f.state.afterCreationLocation=()=>f.balance('p1',0);
 await rejected(()=>f.api.createChallenge(f.sdk,f.user('p1'),{entryAmount:25,publiclyListed,requestKey:'creation_gates_12345'}),expected);
 equal(f.table('Match').length,0);equal(f.table('LedgerJournalBatch').length,0);
 if(issue==='location'){
   const free=await f.api.createChallenge(f.sdk,f.user('p1'),{playMode:'free',entryAmount:0,serviceFee:0,publiclyListed,requestKey:'free_fallback_123456'});
   equal(free.match.play_mode,'free');equal(free.match.player1_certified,false);equal(f.table('LedgerJournalBatch').length,0);
 }
}
for(const amount of [0,4,6,10.01,26,5000,NaN,Infinity,null,true,[],{}]){
 const f=fixture();await rejected(()=>f.api.createChallenge(f.sdk,f.user('p1'),{entryAmount:amount,requestKey:'invalid_amount_12345'}),'invalid_entry');equal(f.table('Match').length,0);
}
{
 const f=fixture();await assert.rejects(()=>f.makeSdk('p1').functions.invoke('manageChallenge',{action:'create',creationVersion:'old',entryAmount:25,serviceFee:2,requestKey:'old_client_123456'}));assertions++;
 await Promise.allSettled(Array.from({length:12},(_,i)=>f.create('parallel_creation_'+i)));
 equal(f.table('Match').length,1);equal(f.table('LedgerJournalBatch').length,1);
 await rejected(()=>f.create('second_creation_key_123'),'open_limit');
}
for(const where of ['LedgerJournalBatch.create.before','LedgerJournalBatch.create.after','LedgerEntry.bulkCreate.partial','Wallet.update','Match.update','barrier.clear.partial']){
 const f=fixture();f.state.fail={where,...(where==='Match.update'?{test:(_id,p)=>p.player1_deposited===true}:{})};
 await assert.rejects(()=>f.create());assertions++;
 const m=f.table('Match')[0];equal(m.challenge_operation_state,'reserving');
 if(where!=='barrier.clear.partial')check(!await f.atomic.acquireUserWalletLock('p1','other'),'Interrupted creator reservation blocks another spend');
 if(where==='LedgerJournalBatch.create.before')f.state.now+=181000;
 await f.api.recoverChallenge(f.sdk,m.id);
 equal(f.barriers.size,0);
 if(where==='LedgerJournalBatch.create.before'){
   equal(f.get(m.id).status,'cancelled');equal(wallet(f,'p1').available_balance,100);equal(f.table('LedgerJournalBatch').length,0);
 }else{
   equal(f.get(m.id).status,'searching');equal(wallet(f,'p1').available_balance,73);equal(f.table('LedgerJournalBatch').length,1);
   await f.api.cancelChallenge(f.sdk,f.user('p1'),m.id);equal(wallet(f,'p1').available_balance,100);
 }
}
for(const where of ['LedgerJournalBatch.create.before','LedgerJournalBatch.create.after','Wallet.update','Match.update','barrier.clear.partial']){
 const f=fixture();const m=await f.create();
 f.state.fail={where,...(where==='Match.update'?{test:(_id,p)=>p.status==='cancelled'}:{})};
 await assert.rejects(()=>f.api.cancelChallenge(f.sdk,f.user('p1'),m.id));assertions++;
 await f.api.recoverChallenge(f.sdk,m.id);await f.api.recoverChallenge(f.sdk,m.id);
 equal(f.get(m.id).status,'cancelled');equal(wallet(f,'p1').available_balance,100);equal(wallet(f,'p1').held_balance,0);equal(f.barriers.size,0);
}
for(const timeControl of ['blitz','rapid','classical']){
 const f=fixture();f.balance('p1',27);selectedTimeControl=timeControl;
 const m=await f.authorize(await f.create());equal(wallet(f,'p1').available_balance,0);
 equal((await f.access.inspectChallengePlayer(f.sdk,'p1',m)).ready,true,'Creator qualifies using own existing reservation');
 await rejected(()=>f.api.authorizeChallenge(f.request,f.sdk,f.user('p1'),m,f.consent),'refresh_required');
 await f.api.consentToHudChallenge(f.sdk,f.user('p1'),m,{...f.consent,consentVersion:f.policy.CHALLENGE_HUD_CONSENT_VERSION});
 equal(f.get(m.id).challenge_consent_version,f.policy.CHALLENGE_CREATION_VERSION);
 const results=await Promise.allSettled(Array.from({length:12},(_,i)=>f.api.acceptChallenge(f.request,f.sdk,f.user(i%2?'p2':'p3'),m,f.consent)));
 equal(results.filter(r=>r.status==='fulfilled'&&r.value.accepted).length,1);
 const accepted=f.get(m.id),opponent=accepted.player2_id;
 equal(f.table('LedgerJournalBatch').length,2);equal(f.table('WalletTransaction').length,4);
 equal(wallet(f,'p1').available_balance,0);equal(wallet(f,opponent).available_balance,73);
 equal(accepted.player1_certified,false);equal(accepted.player2_certified,false);
 await rejected(()=>f.api.readyChallenge(f.request,f.sdk,f.user('p1'),m.id,{action:'ready',presenceId:'ready_session_123456'}),'fair_play_required');
 const beat=await f.api.readyChallenge(f.request,f.sdk,f.user('p1'),m.id,{action:'heartbeat',visible:true,presenceId:'ready_session_123456'});check(beat.needsReady);
 await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);equal(f.table('Game').length,0);
 for(const id of ['p1',opponent])await f.api.readyChallenge(f.request,f.sdk,f.user(id),m.id,attest(f));
 await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);equal(f.table('Game').length,1);
 equal(f.table('Game')[0].white_time_ms,{blitz:180000,rapid:600000,classical:900000}[timeControl]);
 await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);equal(f.table('Game').length,1);equal(f.table('LedgerJournalBatch').length,2);
 await rejected(()=>f.api.cancelChallenge(f.sdk,f.user('p1'),m.id),'already_started');
}
selectedTimeControl=undefined;
for(const where of ['LedgerJournalBatch.create.before','LedgerJournalBatch.create.after','LedgerEntry.bulkCreate.partial','Wallet.update','Match.update','barrier.clear.partial']){
 const f=fixture(),m=await f.authorize(await f.create());
 f.state.fail={where,...(where==='Match.update'?{test:(_id,p)=>p.status==='preparing'}:{})};
 const result=await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);check(result.processing);
 if(where==='LedgerJournalBatch.create.before')f.state.now+=181000;
 await f.api.recoverChallenge(f.sdk,m.id);equal(f.barriers.size,0);
 equal(wallet(f,'p1').available_balance,73);
 if(where==='LedgerJournalBatch.create.before'){equal(wallet(f,'p2').available_balance,100);equal(f.get(m.id).status,'searching');}
 else {equal(wallet(f,'p2').available_balance,73);equal(f.table('LedgerJournalBatch').length,2);equal(f.table('WalletTransaction').length,4);}
 await f.api.cancelChallenge(f.sdk,f.user('p1'),m.id);
 equal(wallet(f,'p1').available_balance,100);equal(wallet(f,'p2').available_balance,100);
}
for(const phase of ['open_expired','accepted_timeout','accepted_cancel']){
 const f=fixture(),m=await f.authorize(await f.create());
 if(phase!=='open_expired')await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);
 f.state.now+=phase==='open_expired'?86400001:121000;
 if(phase==='accepted_cancel')await f.api.cancelChallenge(f.sdk,f.user('p2'),m.id);else await f.api.recoverChallenge(f.sdk,m.id);
 await f.api.recoverChallenge(f.sdk,m.id);
 equal(f.get(m.id).status,'cancelled');for(const id of ['p1','p2']){equal(wallet(f,id).available_balance,100);equal(wallet(f,id).held_balance,0);}
 equal((await summary(f)).reserved_for_matches,0);equal(f.barriers.size,0);
}
{
 const f=fixture(),m=await f.create();
 check(await f.atomic.acquireUserWalletLock('p1','other'));
 await rejected(()=>f.api.cancelChallenge(f.sdk,f.user('p1'),m.id),'wallet_busy');
 await f.atomic.releaseUserWalletLock('p1','other');
 await f.api.cancelChallenge(f.sdk,f.user('p1'),m.id);equal(wallet(f,'p1').available_balance,100);
}
{
 const f=fixture();await rejected(()=>f.api.createChallenge(f.sdk,f.user('p1'),{entryAmount:25,serviceFee:0,requestKey:'wrong_fee_key_12345'}),'terms_changed');
 const m=await f.authorize(await f.create());
 await rejected(()=>f.api.cancelChallenge(f.sdk,f.user('p3'),m.id),'forbidden');
 f.table('User')[1].mfa_bypass=false;
 await assert.rejects(()=>summary(f,'p2'));assertions++;
 const data=await f.makeSdk('unknown').functions.invoke('manageChallenge',{action:'view',inviteCode:m.invite_code});
 check(!('email' in data.data.challenge));check(!('availableBalance' in data.data.challenge));
 const safe=f.load('base44/functions/manageChallenge/entry.ts').exports.safeChallengeMatch({...m,challenge_creation_key:'secret',challenge_claimant_id:'secret'});
 check(!('challenge_creation_key' in safe));check(!('challenge_claimant_id' in safe));
}

// Historical invitations retain their original two-player reservation contract.
for(const phase of ['cancel_open','accept_cancel']){
 const f=fixture();
 const m=await f.sdk.asServiceRole.entities.Match.create({id:'legacy',launch_epoch:2,challenge_version:1,is_private:true,play_mode:'money',player1_id:'p1',wager_amount:25,platform_service_fee:2,time_control:'blitz',clock_initial_ms:300000,display_name:'Blitz (5+0)',status:'searching',invite_code:'a'.repeat(32),challenge_operation_state:'idle',challenge_expires_at:new Date(f.state.now+86400000).toISOString(),player1_deposited:false,player2_deposited:false});
 if(phase==='cancel_open'){
  await f.atomic.acquireUserWalletLock('p1','unrelated');
  await f.api.cancelChallenge(f.sdk,f.user('p1'),m.id);
  equal(f.table('LedgerJournalBatch').length,0);
 }else{
  await f.api.authorizeChallenge(f.request,f.sdk,f.user('p1'),m,f.consent);
  await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),f.get(m.id),f.consent);
  equal(f.table('LedgerJournalBatch').length,1);equal(f.table('LedgerJournalBatch')[0].leg_count,8);
  await f.api.cancelChallenge(f.sdk,f.user('p1'),m.id);
  equal(wallet(f,'p1').available_balance,100);equal(wallet(f,'p2').available_balance,100);
 }
}
// A cleared-for-play ACH source survives reservation and cancellation with its original restriction.
{
 const f=fixture();f.table('WalletTransaction').push({id:'deposit',type:'deposit',status:'completed',provider_last_status:'Processed',deposit_withdrawal_status:'held',deposit_release_at:'2026-09-18T12:00:00Z'});
 f.table('LedgerJournalBatch').push({id:'seed-lots',launch_epoch:2,ledger_group_id:'seed-lots',funding_sequence:1,funding_user_ids:['p1'],funding_provenance_json:JSON.stringify({version:1,users:{p1:{available:[{cents:10000,sources:['deposit']}],held:{}}}})});
 const m=await f.authorize(await f.create());equal((await summary(f)).available_to_play,73);equal((await summary(f)).available_to_withdraw,0);
 f.table('WalletTransaction').find(t=>t.id==='deposit').status='failed';
 equal((await f.access.inspectChallengePlayer(f.sdk,'p1',f.get(m.id))).code,'reservation_unavailable');
 await f.api.cancelChallenge(f.sdk,f.user('p1'),m.id);equal(wallet(f,'p1').available_balance,100);
 equal((await summary(f)).available_to_play,0);equal((await summary(f)).reserved_for_matches,0);
}

console.log('Challenge creation/reservation lifecycle: '+assertions+' assertions passed. Actual handlers and ledger; isolated providers and storage; no live financial activity.');
