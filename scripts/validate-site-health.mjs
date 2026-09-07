import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const policyContext={exports:{},Date,JSON,Math,Number};
vm.runInNewContext(compile(fs.readFileSync('base44/shared/siteHealthPolicy.ts','utf8')),policyContext);
const p=policyContext.exports, now=Date.parse('2026-09-07T18:00:00Z');
assert.equal(p.healthSummary(null,now).status,'unknown');
assert.equal(p.healthSummary({checked_at:new Date(now-36*60000).toISOString(),checks_json:'[]'},now).status,'unknown');
assert.equal(p.overall([{status:'healthy'},{status:'unknown'}]),'unknown');
assert.equal(p.creditCheck({},now).status,'unknown');
const credits={credit_observed_at:new Date(now).toISOString(),credit_cycle_started_at:'2026-08-20T00:00:00Z',credit_renews_at:'2026-09-20T00:00:00Z',credit_used:1000,credit_allowance:20000};
assert.equal(p.creditCheck(credits,now).status,'healthy');
assert.equal(p.creditCheck({...credits,credit_used:19000},now).status,'warning');
assert.equal(p.creditCheck({...credits,credit_used:20000},now).status,'critical');
assert.equal(p.creditCheck({...credits,credit_observed_at:'2026-09-05T00:00:00Z'},now).status,'unknown');
const sample={name:'submitMove',count:100,server_errors:10,network_errors:0,rate_limits:0,slow_count:0};
const telemetry=p.telemetryChecks([{recorded_at:new Date(now).toISOString(),samples_json:JSON.stringify([sample])}],2,now);
assert.equal(telemetry[0].status,'critical');assert.equal(telemetry[1].status,'unknown');
const critical=[{key:'redis',status:'critical'}],healthy=[{key:'redis',status:'healthy'}];
assert.equal(p.shouldNotify(null,critical,now).send,true);
const previous={last_alert_signature:'redis:critical',last_alert_attempt_at:new Date(now-2*3600000).toISOString(),alert_delivery:'accepted'};
assert.equal(p.shouldNotify(previous,critical,now).send,false);
assert.equal(p.shouldNotify(previous,[{key:'redis',status:'unknown'}],now).send,false);
assert.equal(p.shouldNotify(previous,healthy,now).recovered,true);
assert.equal(p.shouldNotify({...previous,last_alert_attempt_at:new Date(now-60000).toISOString()},healthy,now).send,false);
assert.equal(p.shouldNotify({...previous,alert_delivery:'failed_or_unknown'},critical,now).send,true);
let clock=now, user={id:'admin',role:'admin'}, rows={}, writes=[], emails=[], failRedis=false, failMail=false;
class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
const entities=new Proxy({}, {get:(_,name)=>({
 filter:async ()=>rows[name]||[],
 create:async data=>{assert.ok(['SiteHealthSnapshot','GameHealthTelemetry'].includes(name),'unexpected mutation '+name);const r={...data,id:name+'1'}; rows[name]=[r];writes.push({name,data});return r;},
 update:async (id,data)=>{assert.ok(['SiteHealthSnapshot','GameHealthTelemetry','SiteHealthConfig'].includes(name),'unexpected mutation '+name);const r={...(rows[name]?.[0]||{}),...data,id};rows[name]=[r];writes.push({name,data});return r;}
})});
const sdk={auth:{me:async()=>user},asServiceRole:{entities,integrations:{Core:{SendEmail:async data=>{emails.push(data);if(failMail)throw Error('mail failure');return {};}}}}};
const env={FAIR_PLAY_SCREENING_ENABLED:'true',FAIR_PLAY_ANALYZER_URL:'https://test.ondigitalocean.app',SEAMLESS_ATOMIC_REDIS_REST_URL:'https://test.upstash.io',SEAMLESS_ATOMIC_REDIS_REST_TOKEN:'mock',RATING_ATOMIC_REDIS_REST_URL:'https://ratings.upstash.io',RATING_ATOMIC_REDIS_REST_TOKEN:'mock'};
function handler(name){
 let serve;
 const source=fs.readFileSync('base44/functions/'+name+'/entry.ts','utf8');
 const context={exports:{},require:id=>id.startsWith('npm:')?{createClientFromRequest:()=>sdk}:p,
 Deno:{serve:fn=>serve=fn,env:{get:k=>env[k]}},Date:Clock,Response,Request,URL,AbortSignal,
 setTimeout,clearTimeout,console:{log(){},warn(){},error(){}},
 fetch:async (url,options)=>{
   url=String(url);
   if(url.includes('upstash.io')){assert.equal(options.body,'["PING"]');return Response.json({result:failRedis?'NO':'PONG'});}
   assert.equal(options.method,'GET');return url.includes('ondigitalocean')?Response.json({ok:true}):new Response('<html>ChessBet</html>');
 }};
 vm.runInNewContext(compile(source),context);return serve;
}
const request=(body={})=>new Request('https://test.local/',{method:'POST',body:JSON.stringify(body)});
for(const name of ['getSiteHealth','runSiteHealthChecks','updateSiteHealthSettings']){
 const fn=handler(name);user=null;assert.equal((await fn(request())).status,401);
 user={id:'player',role:'user'};assert.equal((await fn(request())).status,403);
}
assert.equal(writes.length,0);assert.equal(emails.length,0);user={id:'admin',role:'admin'};
rows.SiteHealthConfig=[{key:'current',enabled:true,alerts_enabled:true,alert_email:'hello@worldchessbet.com',...credits}];
const collect=handler('runSiteHealthChecks');
let result=await (await collect(request({persist:true}))).json();
assert.equal(result.persisted,true);assert.equal(emails.length,0);assert.equal(result.status,'unknown');
clock+=15*60000;failRedis=true;result=await(await collect(request({persist:true}))).json();
assert.equal(result.status,'critical');assert.equal(emails.length,1);assert.equal(emails[0].to,'hello@worldchessbet.com');
await collect(request({persist:true}));assert.equal(emails.length,1);
clock+=15*60000;await collect(request({persist:true}));assert.equal(emails.length,1);
clock+=60*60000;failRedis=false;await collect(request({persist:true}));assert.equal(emails.length,2);assert.match(emails[1].subject,/recovery/);
assert.ok(JSON.stringify(rows.SiteHealthSnapshot).length<90000);
const record=handler('recordGameHealth');user={id:'player',role:'user'};
result=await(await record(request({samples:[{...sample,game_id:'must-not-save'}]}))).json();
assert.equal(result.accepted,true);assert.ok(!rows.GameHealthTelemetry[0].samples_json.includes('must-not-save'));
assert.equal((await(await record(request({samples:[sample]}))).json()).accepted,false);
assert.equal((await record(request({samples:[{...sample,count:-1}]}))).status,400);
assert.equal((await record(request({samples:Array(4).fill(sample)}))).status,400);
const publicFn=handler('publicSiteHealth');result=await(await publicFn(new Request('https://test.local'))).json();assert.deepEqual(Object.keys(result),['status']);
clock+=36*60000;assert.equal((await publicFn(new Request('https://test.local'))).status,503);
let calls=[],resultObject={data:{ok:true}},rejectError=null;
const client={functions:{invoke:async(...args)=>{calls.push(args);if(rejectError)throw rejectError;return resultObject;}}};
const front={exports:{},Date:Clock,performance:{now:()=>clock}};
vm.runInNewContext(compile(fs.readFileSync('src/lib/gameHealthTelemetry.js','utf8')),front);
front.exports.installGameHealthTelemetry(client);
const payload={game_id:'private',move:'e4'};assert.equal(await client.functions.invoke('submitMove',payload),resultObject);assert.equal(calls[0][1],payload);
assert.equal(calls.length,1);
rejectError={response:{status:429}};await assert.rejects(client.functions.invoke('getGameClock',payload),e=>e===rejectError);rejectError=null;
clock+=121000;await client.functions.invoke('gameHeartbeat',payload);await new Promise(resolve=>setTimeout(resolve,0));
const sent=calls.find(c=>c[0]==='recordGameHealth');assert.ok(sent);assert.ok(!JSON.stringify(sent).includes('private'));assert.ok(!JSON.stringify(sent).includes('e4'));
console.log('PASS: stale/unknown, credits, gameplay thresholds, authorization, collection persistence, alert cooldown/recovery, bounded telemetry, public redaction, original gameplay behavior. No live provider calls or email sent.');
