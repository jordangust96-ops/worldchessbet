import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as gates from '../base44/shared/jurisdictionGates.js';
import * as regions from '../base44/shared/jurisdictionRegions.js';
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


const wallet=load('base44/shared/walletOnboardingLocation.ts',{'./jurisdictionGates.js':gates,'./jurisdictionRegions.js':regions}).exports;
const cases = [
 ['is_anonymous_vpn', /identified as a VPN/], ['is_tor_exit_node', /Tor exit node/],
 ['is_residential_proxy', /residential proxy/], ['is_public_proxy', /public proxy/],
 ['is_anonymous_proxy', /anonymous proxy/], ['is_hosting_provider', /hosting or data-center/],
 ['is_anonymous', /anonymous or location-masking network/],
 ['is_satellite_provider', /satellite network/], ['is_anycast', /anycast IP/],
 ['low_confidence', /sufficiently confident/], ['broad_radius', /too large an area/],
 ['provider_error', /try again shortly/], ['missing_location', /enough location information/],
 ['configuration_missing', /not configured/], ['geo_mismatch', /device location and network location disagree/]
];
let checks=0;
for(const shape of ['traits','anonymizer']) for(const [condition,expected] of cases) {
 const rows=[];
 const sdk={auth:{me:async()=>({id:'u',role:'user'})},asServiceRole:{entities:{User:{update:async()=>{}},
 JurisdictionVerificationLog:{create:async r=>rows.push(r),filter:async q=>rows.filter(r=>!q.verification_result||r.verification_result===q.verification_result)}}}};
 const env={MAXMIND_GEOIP_ENABLED:'true',MAXMIND_ACCOUNT_ID:'test',MAXMIND_LICENSE_KEY:'test'};
 if(condition==='configuration_missing') env.MAXMIND_GEOIP_ENABLED='false';
 const lookup={country:{iso_code:'US',confidence:99},subdivisions:[{iso_code:'GA',confidence:99}],location:{accuracy_radius:5,latitude:33.75,longitude:-84.39},traits:{},anonymizer:{}};
 // Connection-type fields remain traits in MaxMind; anonymizer flags can occur in either shape.
 lookup[['is_anycast','is_satellite_provider'].includes(condition)?'traits':shape][condition]=true;
 if(condition==='low_confidence') lookup.subdivisions[0].confidence=10;
 if(condition==='broad_radius') lookup.location.accuracy_radius=1000;
 if(condition==='missing_location') lookup.subdivisions=[];
 const geo=load('base44/shared/requestJurisdiction.ts',{'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},'./jurisdictionGates.js':gates,'./jurisdictionRegions.js':regions},{Deno:{env:{get:k=>env[k]}},fetch:async()=>condition==='provider_error'?new Response('',{status:503}):Response.json(lookup)}).exports;
 const result=await (await geo.getRequestJurisdiction(new Request('https://test.invalid',{headers:{'true-client-ip':'192.0.2.1'}}),
 {triggerEvent:'wallet_onboarding',...(condition==='geo_mismatch'?{browserGeoPermission:'granted',browserLatitude:42.33,browserLongitude:-83.05,browserAccuracyMeters:55}:{})},{fresh:true,requireLocation:true})).json();
 assert.notEqual(result.status,'approved'); assert.match(result.reason,expected,condition);
 assert.equal(rows.length,1); assert.equal(rows[0].pre_bypass_reason,result.reason);
 const saved=await wallet.walletOnboardingLocation(sdk,'u');
 assert.equal(saved.allowed,false);assert.equal(saved.promptEligible,false);assert.match(saved.reason,expected,condition+' reload');
 if(condition!=='is_anonymous_vpn') assert.doesNotMatch(saved.reason,/identified as a VPN/);
 checks++;
}
for (const {country, state, expected} of [
  {country:'US', state:'MI', expected:/^Paid contests are unavailable in your current location\.\n\nYou can enter paid contests/},
  {country:'CA', state:'', expected:/^Paid contests are unavailable in your current country\.\n\nYou can still create or join free challenges\.$/},
]) {
  const rows = [];
  const sdk = {
    auth:{me:async()=>({id:'u',role:'user'})},
    asServiceRole:{entities:{
      User:{update:async()=>{}},
      JurisdictionVerificationLog:{
        create:async row=>rows.push(row),
        filter:async query=>rows.filter(row=>!query.verification_result || row.verification_result===query.verification_result),
      },
    }},
  };
  const env = {MAXMIND_GEOIP_ENABLED:'true', MAXMIND_ACCOUNT_ID:'test', MAXMIND_LICENSE_KEY:'test'};
  const lookup = {
    country:{iso_code:country, confidence:99},
    subdivisions:state ? [{iso_code:state, confidence:99}] : [],
    location:{accuracy_radius:5},
  };
  const {getRequestJurisdiction} = load('base44/shared/requestJurisdiction.ts', {
    'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
    './jurisdictionGates.js':gates,
    './jurisdictionRegions.js':regions,
  }, {Deno:{env:{get:key=>env[key]}}, fetch:async()=>Response.json(lookup)}).exports;
  const request = new Request('https://test.invalid', {headers:{'true-client-ip':'192.0.2.1'}});
  const context = {triggerEvent:'wallet_onboarding'};
  const fresh = await (await getRequestJurisdiction(request, context, {fresh:true, requireLocation:true})).json();
  assert.equal(fresh.status, 'blocked');
  assert.match(fresh.reason, expected);
  assert.equal(rows.length, 1);
  rows[0].pre_bypass_reason = 'Old rejection copy';
  const saved = await wallet.walletOnboardingLocation(sdk, 'u');
  assert.equal(saved.reason, fresh.reason, 'wallet reload replaces old saved copy');
  assert.equal(saved.promptEligible, true);
  if (state) {
    const cached = await (await getRequestJurisdiction(request, context)).json();
    assert.equal(cached.cached, true);
    assert.equal(cached.reason, fresh.reason, 'cached result replaces old saved copy');
    assert.equal(rows.length, 1);
  }
}
const multiple=gates.getLocationDenialMessage({is_anonymous_vpn:true,is_tor_exit_node:true,is_anonymous:true});
assert.match(multiple,/VPN/);assert.match(multiple,/Tor exit node/);assert.doesNotMatch(multiple,/anonymous or location-masking/);
assert.doesNotMatch(gates.getLocationDenialMessage({vpn_or_proxy_detected:true}),/identified as a VPN/);
assert.equal(gates.getLocationDenialMessage({}), '');
console.log(`Location denial messages: ${checks} provider-to-response-to-wallet-reload cases passed, plus overlapping and legacy flags. No external calls.`);
