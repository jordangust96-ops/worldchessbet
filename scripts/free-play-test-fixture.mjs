import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import { Chess } from 'chess.js';

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
let selectedTimeControl;
function fixture() {
  const state={now:Date.parse('2026-09-14T12:00:00Z'),serial:0,db:{},fail:null,location:true,errors:[],lookups:0,creates:[],emails:[],reads:[],noMoney:false,paid:true};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[state.now]));} static now(){return state.now;} }
  const table=name=>state.db[name] ||= [];
  const read=name=>{state.reads.push(name);if(state.noMoney && /Wallet|Ledger|Bank|Identity|Socure|Payment|Transfer/.test(name))throw Error('Unexpected free-game financial access: '+name);};
  const validate=(name,patch)=>{if(!['Match','Game','ContestRecord'].includes(name))return;const schema=JSON.parse(fs.readFileSync(path.join(root,'base44/entities/'+name+'.jsonc'),'utf8'));for(const [key,value] of Object.entries(patch)){const rule=schema.properties[key];if(rule?.enum && !rule.enum.includes(value))throw Error('Schema enum violation: '+name+'.'+key+'='+value);}};
  const entities=new Proxy({}, {get:(_,name)=>({
    filter:async(query={},sort='',limit=500,skip=0,fields)=>{
      read(name);let rows=table(name).filter(row=>matches(row,query));
      if(sort){const reverse=sort[0]==='-';const field=reverse?sort.slice(1):sort;rows=[...rows].sort((a,b)=>String(a[field]??'').localeCompare(String(b[field]??''))*(reverse?-1:1));}
      rows=rows.slice(skip,skip+limit);
      return clone(rows.map(row=>fields?Object.fromEntries(['id',...fields].filter(k=>row[k]!==undefined).map(k=>[k,row[k]])):row));
    },
    list:async(sort='',limit=500,skip=0)=>entities[name].filter({},sort,limit,skip),
    get:async id=>{read(name);const row=table(name).find(x=>x.id===id);if(!row)throw Error(`not_found:${name}:${id}`);return clone(row);},
    create:async data=>{
      validate(name,data);
      if(state.noMoney && /Wallet|Ledger|Bank|Payment|Transfer/.test(name))throw Error('Unexpected financial write: '+name);
      if(state.fail?.where===`${name}.create.before`){state.fail=null;throw Error('injected_before_commit');}
      const row={id:`${String(name).toLowerCase()}-${++state.serial}`,created_date:new Clock().toISOString(),...clone(data)};
      table(name).push(row);state.creates.push({name,id:row.id});
      if(state.fail?.where===`${name}.create.after`){state.fail=null;throw Error('injected_lost_response');}
      return clone(row);
    },
    update:async(id,patch)=>{
      validate(name,patch);
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
      if(specifier.startsWith('npm:chess.js'))return {Chess};
      if(specifier.startsWith('npm:@base44/sdk'))return {createClientFromRequest:r=>makeSdk(r.headers.get('x-test-user')||'p1')};
      const resolved=path.resolve(path.dirname(file),specifier);
      if(resolved.endsWith('/ratingAtomicStore.ts'))return {acquireRatingProcessingLock:async owner=>acquire('rating',owner),renewRatingProcessingLock:async owner=>mutex.get('rating')===owner,releaseRatingProcessingLock:async owner=>release('rating',owner)};
      if(resolved.endsWith('/seamlessAtomicStore.ts'))return atomic;
      if(resolved.endsWith('/seamlessFundingConfig.ts'))return {paidContestsEnabled:()=>state.paid};
      if(resolved.endsWith('/identityEligibility.js'))return {hasVerifiedIdentity:async(sdk,user)=>!!user && (await sdk.asServiceRole.entities.User.get(user.id)).verified===true};
      if(resolved.endsWith('/requestJurisdiction.ts'))return {getRequestJurisdiction:async(req,context,options)=>{equal(req.headers.get('cf-connecting-ip'),'198.51.100.5');equal(context.triggerEvent,'wallet_onboarding');equal(options.fresh,true);state.lookups++;return Response.json({status:state.location?'approved':'blocked'});}};
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
      TextEncoder,TextDecoder,Map,Set,crypto:crypto.webcrypto,console:{error:(...x)=>state.errors.push(x),log:()=>{}},
      setInterval:()=>1,clearInterval:()=>{},setTimeout:fn=>{fn();return 1;},clearTimeout:()=>{},
      Deno:{env:{get:()=>undefined},serve:handler=>{result.handler=handler;}},
    },{filename:file});
    result.exports=module.exports;return result;
  }
  makeSdk=id=>({auth:{me:async()=>clone(table('User').find(u=>u.id===id)||null)},
    asServiceRole:{entities,functions:{invoke:async(name,body)=>makeSdk('p1').functions.invoke(name,body)},integrations:{Core:{SendEmail:async data=>{state.emails.push(clone(data));return {sent:true};}}}},
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
  api.createChallenge=(sdk,u,body,req=request)=>originalCreate(sdk,u,body,req);
  const consent={agree:true,entryAmount:25,serviceFee:2};
  const get=id=>clone(table('Match').find(m=>m.id===id));
  const balance=(id,amount)=>{
    Object.assign(table('Wallet').find(w=>w.user_id===id),{available_balance:amount,balance:amount,total_balance:amount});
    Object.assign(table('LedgerEntry').find(e=>e.id==='seed-'+id),{credit_amount:amount,available_delta:amount,total_deposited_delta:amount});
  };
  const create=async(key='creation_key_123456')=>{
    const r=await api.createChallenge(sdk,user('p1'),{entryAmount:25,requestKey:key,...(selectedTimeControl ? {timeControl:selectedTimeControl} : {})});return get(r.match.id);
  };
  const authorize=async m=>{await api.authorizeChallenge(request,sdk,user('p1'),m,consent);return get(m.id);};
  return {state,db:state.db,table,api,policy,access,sdk,makeSdk,atomic,barriers,mutex,load,user,request,consent,get,balance,create,authorize};
}
async function rejected(work,code){let failure;try{await work();}catch(error){failure=error;}check(failure,`Expected rejection ${code}`);if(code)equal(failure.code,code);}


export {fixture,check,equal,rejected};
export const assertionCount=()=>assertions;
