import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isMatchLocationEvidence, MATCH_LOCATION_MAX_AGE_MS } from '../base44/shared/matchLocationPolicy.js';
import * as gates from '../base44/shared/jurisdictionGates.js';
import * as regions from '../base44/shared/jurisdictionRegions.js';

const now = Date.now();
const match = { id:'m', launch_epoch:2, status:'preparing', player1_id:'p1', player2_id:'p2',
  preparation_started_at:new Date(now-60000).toISOString(),
  player1_certified:true, player2_certified:true, player1_deposited:true, player2_deposited:true };
const evidence = userId => ({ user_id:userId, related_entity_type:'match', related_entity_id:'m',
  country_confidence:99, subdivision_confidence:99, accuracy_radius_km:5,
  trigger_event:'match_readiness', verification_result:'approved', provider:'MaxMind',
  geolocation_enforcement_enabled:true, enforcement_bypassed:false, vpn_or_proxy_detected:false,
  ip_address:userId==='p1'?'198.51.100.1':'203.0.113.2',
  detected_country:'US', detected_state:'GA', verified_at:new Date(now-1000).toISOString() });
assert.equal(isMatchLocationEvidence(evidence('p1'),match,'p1',now),true);
for(const patch of [
  {user_id:'p2'}, {related_entity_id:'other'}, {trigger_event:'deposit_start'},
  {trigger_event:'create_match'}, {verification_result:'blocked'}, {verification_result:'verification_failed'},
  {verification_result:'unknown'}, {provider:'Other'}, {enforcement_bypassed:true},
  {geolocation_enforcement_enabled:false}, {vpn_or_proxy_detected:true}, {ip_address:''},
  {detected_state:'MI'}, {detected_country:'CA'},
  {verified_at:new Date(now+1000).toISOString()}, {verified_at:'invalid'},
  {verified_at:new Date(now-MATCH_LOCATION_MAX_AGE_MS-1).toISOString()}
]) assert.equal(isMatchLocationEvidence({...evidence('p1'),...patch},match,'p1',now),false,JSON.stringify(patch));
assert.equal(isMatchLocationEvidence(evidence('p1'),{...match,preparation_started_at:new Date(now).toISOString()},'p1',now),false);

function load(path, dependencies, globals={}) {
  const source=fs.readFileSync(path,'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  let handler;
  vm.runInNewContext(code,{
    module,exports:module.exports,Response,Request,Date,URL,AbortSignal,btoa,
    console:{error:()=>{}},setTimeout,crypto:globalThis.crypto,
    Deno:{env:{get:()=>undefined},serve:fn=>{handler=fn;}},
    require:name=>{if(!(name in dependencies))throw Error('Unexpected dependency '+name);return dependencies[name];},
    ...globals
  });
  return {exports:module.exports,handler};
}

const policyModule={isMatchLocationEvidence};
const helpers=load('base44/shared/matchLocation.ts',{
  './requestJurisdiction.ts':{getRequestJurisdiction:async(req,context,policy)=>{
    assert.equal(req.headers.get('true-client-ip'),'198.51.100.1');
    assert.equal(context.triggerEvent,'match_readiness');
    assert.equal(context.relatedEntityId,'m');
    assert.equal(policy.fresh,true); assert.equal(policy.requireLocation,true);
    return Response.json({status:'approved'});
  }},
  './matchLocationPolicy.js':policyModule
},{Deno:{env:{get:()=> 'true'}}}).exports;
await helpers.verifyMatchLocation(new Request('https://example.invalid',{headers:{'true-client-ip':'198.51.100.1','cf-connecting-ip':'74.220.48.45','x-forwarded-for':'198.51.100.77'}}),match);
let logs={p1:evidence('p1'),p2:evidence('p2')};
const client={asServiceRole:{entities:{JurisdictionVerificationLog:{filter:async q=>[logs[q.user_id]]}}}};
assert.equal((await helpers.getMatchLocationReadiness(client,match)).ready,true);
logs.p2={...logs.p2,verification_result:'verification_failed'};
const pending=await helpers.getMatchLocationReadiness(client,match);
assert.equal(pending.ready,false);
assert.deepEqual([...pending.requiredUserIds],['p2']);
logs.p2=evidence('p2');

// Real location handler, with network and SDK mocked: readiness must bypass
// old same-IP evidence and the general admin maintenance bypass.
for(const role of ['user','admin']) {
  let lookups=0, auditWrites=0, cachedReads=0;
  const sdk={auth:{me:async()=>({id:'p1',role})},asServiceRole:{entities:{
    User:{update:async()=>{}},
    JurisdictionVerificationLog:{
      filter:async()=>{cachedReads++;return [evidence('p1')];},
      create:async row=>{auditWrites++;assert.equal(row.trigger_event,'match_readiness');assert.equal(row.ip_address,'198.51.100.1');}
    }
  }}};
  const geo=load('base44/shared/requestJurisdiction.ts',{
    'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
    './jurisdictionGates.js':gates,'./jurisdictionRegions.js':regions
  },{
    Deno:{env:{get:name=>({MAXMIND_GEOIP_ENABLED:'true',MAXMIND_ACCOUNT_ID:'test-account',MAXMIND_LICENSE_KEY:'test-key'})[name]}},
    fetch:async url=>{lookups++;assert.ok(url.endsWith('/198.51.100.1'));return Response.json({
      country:{iso_code:'US',confidence:99},subdivisions:[{iso_code:'GA',confidence:99}],location:{accuracy_radius:5},traits:{}
    });}
  }).exports;
  const result=await (await geo.getRequestJurisdiction(
    new Request('https://example.invalid',{headers:{'true-client-ip':'198.51.100.1','cf-connecting-ip':'74.220.48.45','x-forwarded-for':'198.51.100.77'}}),
    {triggerEvent:'match_readiness',relatedEntityType:'match',relatedEntityId:'m'},
    {fresh:true,requireLocation:true}
  )).json();
  assert.equal(result.status,'approved'); assert.equal(result.adminBypass,undefined);
  assert.equal(lookups,1); assert.equal(cachedReads,0); assert.equal(auditWrites,1);
}


// State-confidence boundary regression: execute the real handler with mocked
// provider/SDK so these checks never call MaxMind or change player records.
for (const c of [
  {stateConfidence:99,countryConfidence:99,browser:true,expected:'verification_failed'},
  {stateConfidence:10,countryConfidence:99,radius:1000,expected:'verification_failed'},
  {stateConfidence:99,countryConfidence:99,radius:1000,expected:'verification_failed'},
  {stateConfidence:90,countryConfidence:99,expected:'approved'},
  {stateConfidence:89,countryConfidence:99,expected:'verification_failed'},
  {stateConfidence:undefined,countryConfidence:99,expected:'verification_failed'},
  {stateConfidence:90,countryConfidence:49,expected:'verification_failed'},
  {stateConfidence:90,countryConfidence:50,expected:'approved'},
  {stateConfidence:90,countryConfidence:99,vpn:true,expected:'verification_failed'},
  {stateConfidence:90,countryConfidence:99,state:'MI',expected:'blocked'},
  {stateConfidence:90,countryConfidence:99,override:'95',expected:'verification_failed'},
  {stateConfidence:89,countryConfidence:99,override:'0',expected:'verification_failed'}
]) {
  const rows=[];
  const sdk={auth:{me:async()=>({id:'confidence-test',role:'user'})},asServiceRole:{entities:{
    User:{update:async()=>{}},JurisdictionVerificationLog:{filter:async()=>[],create:async row=>rows.push(row)}
  }}};
  const geo=load('base44/shared/requestJurisdiction.ts',{
    'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
    './jurisdictionGates.js':gates,'./jurisdictionRegions.js':regions
  },{
    Deno:{env:{get:name=>({MAXMIND_GEOIP_ENABLED:'true',MAXMIND_ACCOUNT_ID:'test',MAXMIND_LICENSE_KEY:'test',MAXMIND_MIN_SUBDIVISION_CONFIDENCE:c.override})[name]}},
    fetch:async()=>Response.json({country:{iso_code:'US',confidence:c.countryConfidence},
      subdivisions:[{iso_code:c.state||'GA',confidence:c.stateConfidence}],location:{accuracy_radius:c.radius??5,latitude:33.75,longitude:-84.39},traits:{is_anonymous_vpn:!!c.vpn}})
  }).exports;
  const result=await (await geo.getRequestJurisdiction(
    new Request('https://example.invalid',{headers:{'true-client-ip':'198.51.100.1','cf-connecting-ip':'74.220.48.45','x-forwarded-for':'198.51.100.77'}}),
    {triggerEvent:'manual',...(c.browser?{browserGeoPermission:'granted',browserLatitude:42.33,browserLongitude:-83.05,browserAccuracyMeters:55}:{})},{fresh:true,requireLocation:true}
  )).json();
  assert.equal(result.status,c.expected,JSON.stringify(c));
  assert.equal(rows.length,1);
  assert.equal(rows[0].verification_result,c.expected);
}
console.log('State confidence: 12 boundary cases passed, including false GA approval, radius, country, VPN and region restrictions.');

// Execute both actual start handlers: invalid evidence must cause zero writes,
// zero game creation and zero downstream start calls.
for(const name of ['finalizeMatchStart','getOrCreateGame']) {
  let writes=0,invokes=0;
  const sdk={auth:{me:async()=>({id:'p1'})},asServiceRole:{entities:{
    Match:{get:async()=>({...match,status:name==='getOrCreateGame'?'both_ready':'preparing'}),update:async()=>{writes++;}},
    Game:{create:async()=>{writes++;}}
  }},functions:{invoke:async()=>{invokes++;}}};
  const loaded=load('base44/functions/'+name+'/entry.ts',{
    'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
    '../../shared/matchLocation.ts':{getMatchLocationReadiness:async()=>({ready:false,requiredUserIds:['p2']}),matchLocationRequiredResponse:helpers.matchLocationRequiredResponse},
    '../../shared/integrationEvents.ts':{recordIntegrationEvent:async()=>{}}
  });
  const response=await loaded.handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({matchId:'m'})}));
  assert.equal(response.status,403,name);
  assert.equal((await response.json()).action,'match_location_required');
  assert.equal(writes,0);assert.equal(invokes,0);
}

// Execute a funded-player recheck: the original request is preserved and
// no reservation or certification is repeated, on either success or failure.
for (const status of ['approved', 'verification_failed']) {
  let checks=0, reservations=0, otherCalls=0;
  const req=new Request('https://example.invalid',{method:'POST',body:JSON.stringify({matchId:'m'})});
  const sdk={auth:{me:async()=>({id:'p1'})},asServiceRole:{entities:{Match:{get:async()=>({...match})}}},
    functions:{invoke:async(name)=>{otherCalls++;assert.equal(name,'finalizeMatchStart');return {data:{match:{...match,status:'in_progress'}}};}}};
  const loaded=load('base44/functions/confirmMatchReadiness/entry.ts',{
    'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
    '../../shared/lockWager.ts':{lockWager:async()=>{reservations++;throw Error('duplicate reservation');}},
    '../../shared/matchLocation.ts':{verifyMatchLocation:async(original)=>{checks++;assert.equal(original,req);return {status};}}
  });
  const response=await loaded.handler(req);
  assert.equal(response.status,status==='approved'?200:403);
  assert.equal(checks,1);assert.equal(reservations,0);
  assert.equal(otherCalls,status==='approved'?1:0);
}

const confirm=fs.readFileSync('base44/functions/confirmMatchReadiness/entry.ts','utf8');
assert.ok(confirm.includes('await lockWager(req, {'));
assert.ok(confirm.includes('alreadyReserved && match.status'));
assert.ok(confirm.includes('await verifyMatchLocation(req, match)'));
const lock=fs.readFileSync('base44/shared/lockWager.ts','utf8');
assert.ok(lock.indexOf('await verifyMatchLocation(req, match')<lock.indexOf('await postLedgerLegs('));
for(const name of ['createMatch','acceptMatch'])
  assert.ok(fs.readFileSync('base44/functions/'+name+'/entry.ts','utf8').includes('await runContestEligibility(req, {'));
assert.ok(fs.readFileSync('base44/shared/runContestEligibility.ts','utf8').includes('getRequestJurisdiction(req, {'));
console.log('Match location passed: match/user binding, two-player freshness, failure/expiry refusal, original edge IP, fresh provider checks for every role, and no game creation on invalid evidence.');
