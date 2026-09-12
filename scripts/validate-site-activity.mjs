import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {computeRange, readAll, buildActivityMetrics, journalLegs, ms} from '../base44/shared/siteActivityMetrics.js';

const locationSource = fs.readFileSync('base44/shared/walletOnboardingLocation.ts','utf8').replaceAll('export ', '');
const ctx = vm.createContext({Date});
vm.runInContext(locationSource, ctx);
const validLocation = ctx.isWalletLocationEvidence;
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual,expected); checks++; };
const now = new Date('2026-09-12T17:00:00Z');
const range = computeRange({preset:'today'},now);
eq(computeRange({preset:'7d'},now).dayKeys.length,7);
eq(computeRange({preset:'30d'},now).gaStart,'2026-08-14');
eq(computeRange({preset:'90d'},now).dayKeys.length,90);
eq(computeRange({preset:'yesterday'},now).end.toISOString(),'2026-09-11T23:59:59.999Z');
eq(ms('2026-09-12T04:00:00.123000'),Date.parse('2026-09-12T04:00:00.123Z'));
for(const body of [{preset:'custom',startDate:'2026-02-30',endDate:'2026-03-01'},{preset:'custom',startDate:'2026-09-13',endDate:'2026-09-12'},{preset:'custom',startDate:'2026-01-01',endDate:'2026-09-12'},{preset:'invalid'}]) {
  assert.throws(()=>computeRange(body,now)); checks++;
}
const all=Array.from({length:1001},(_,i)=>({id:String(i)}));
const offsets=[];
eq((await readAll({filter:async(q,sort,limit,skip)=>{offsets.push(skip);return all.slice(skip,skip+limit);}})).length,1001);
eq(offsets,[0,500,1000]);
await assert.rejects(readAll({filter:async(q,s,l,skip)=>{if(skip)throw new Error('page failed');return all.slice(0,500);}})); checks++;
await assert.rejects(readAll({filter:async()=>all.slice(0,500)})); checks++;

const at='2026-09-12T10:00:00Z', before='2026-09-10T10:00:00Z';
function batch(group,legs,occurred=at) {
 return {id:group,ledger_group_id:group,launch_epoch:2,created_date:occurred,created_at:occurred,leg_count:legs.length,
 total_debit:legs.reduce((s,r)=>s+(r.debit_amount||0),0), total_credit:legs.reduce((s,r)=>s+(r.credit_amount||0),0),
 legs_json:JSON.stringify(legs)};
}
const received=batch('deposit-settlement',[
 {ledger_account:'settlement',debit_amount:10},
 {ledger_account:'user_account',user_id:'old-user',wallet_transaction_id:'dep',credit_amount:10,total_deposited_delta:10}
]);
const sources={
 users:[{id:'new-user',created_date:at},{id:'old-user',created_date:before}],
 matches:[{id:'match',launch_epoch:2,created_date:at,wager_amount:5,status:'completed',player1_id:'new-user',player2_id:'old-user',preparation_started_at:at,completed_at:at},
 {id:'test-match',created_date:at,wager_amount:500,status:'completed'}],
 transactions:[{id:'dep',created_date:before,launch_epoch:2,type:'deposit',amount:10,status:'completed',integration_status:'settled',deposit_hold_status:'held'},
 {id:'pending',created_date:before,launch_epoch:2,type:'deposit',amount:20,status:'pending',integration_status:'submitted'},
 {id:'old-bonus',created_date:at,type:'deposit',amount:500,status:'completed',source_event:'early_access_bonus'},
 {id:'prelaunch',created_date:'2026-09-09T21:00:00Z',launch_epoch:2,type:'deposit',amount:500,status:'completed'},
 {id:'withdrawal',created_date:before,launch_epoch:2,type:'withdrawal',amount:7,status:'processing'},
 {id:'failed',created_date:at,launch_epoch:2,type:'deposit',amount:9,status:'failed'}],
 journals:[received,{...received,id:'same-group'},
 batch('fee',[{ledger_account:'suspense',debit_amount:2},{ledger_account:'platform_revenue',credit_amount:2,transaction_type:'platform_fee'}]),
 batch('fee-refund',[{ledger_account:'platform_revenue',debit_amount:1,transaction_type:'reversal'},{ledger_account:'user_account',credit_amount:1}]),
 batch('returned-deposit',[{ledger_account:'user_account',user_id:'old-user',debit_amount:3,total_deposited_delta:-3},{ledger_account:'settlement',credit_amount:3}]),
 batch('withdrawal-settle',[{ledger_account:'user_account',user_id:'old-user',debit_amount:4,total_withdrawn_delta:4},{ledger_account:'settlement',credit_amount:4}])],
 wallets:[{available_balance:12.34,held_balance:10}],declines:[],
 locations:[],identities:[],banks:[]
};
const loc={id:'loc',user_id:'new-user',provider:'MaxMind',verification_result:'approved',pre_bypass_verification_result:'approved',geolocation_enforcement_enabled:true,enforcement_bypassed:false,vpn_or_proxy_detected:false,ip_address:'192.0.2.1',detected_country:'US',detected_state:'MI',trigger_event:'wallet_onboarding',verified_at:at};
sources.locations=[loc,{...loc,id:'retry'}, {...loc,id:'blocked',verification_result:'blocked'},
 {...loc,id:'failure',verification_result:'verification_failed'}, {...loc,id:'bypass',enforcement_bypassed:true},
 {...loc,id:'gameplay',user_id:'game-user',trigger_event:'create_match'},
 {...loc,id:'legacy',user_id:'old-user',verified_at:'2026-09-10T20:00:00Z',trigger_event:'app_access'}];
sources.identities=[
 {id:'id1',user_id:'new-user',status:'verified',environment:'production',completed_at:at},
 {id:'id2',user_id:'other-user',status:'rejected',environment:'production',completed_at:at},
 {id:'id3',status:'review_required',environment:'production',completed_at:at},
 {id:'id4',status:'pending',environment:'production',requested_at:at,expires_at:'2026-09-12T18:00:00Z'},
 {id:'id5',status:'pending',environment:'production',requested_at:at,expires_at:'2026-09-12T11:00:00Z'},
 {id:'id6',status:'verified',environment:'sandbox',completed_at:at}];
sources.banks=[
 {id:'b1',source_id:'s1',user_id:'new-user',status:'verified',added_at:at,verified_at:at,created_date:at},
 {id:'b1duplicate',source_id:'s1',user_id:'new-user',status:'verified',added_at:at,verified_at:at,created_date:at},
 {id:'b2',source_id:'s2',user_id:'new-user',status:'deleted',added_at:at,created_date:at},
 {id:'b3',source_id:'s3',user_id:'old-user',status:'pending_verification',added_at:before,created_date:before}];
const result=buildActivityMetrics(sources,range,validLocation,now);
eq(result.internal.deposits,1); eq(result.internal.depositVolume,10);
eq(result.internal.depositReturns,3); eq(result.internal.withdrawalVolume,4);
eq(result.internal.platformRevenue,1); eq(result.internal.feeCredits,2); eq(result.internal.feeRefunds,1);
eq(result.internal.pendingDeposits,1); eq(result.internal.pendingDepositVolume,20); eq(result.internal.heldDepositVolume,10);
eq(result.internal.pendingWithdrawalVolume,7); eq(result.internal.availableBalance,12.34);
eq(result.internal.depositConversion,0); eq(result.internal.failedTransfers,1); eq(result.internal.matchesHosted,1);
eq(result.onboarding.locationAccepted,2);eq(result.onboarding.locationRejected,1);eq(result.onboarding.locationUnresolved,2);
eq(result.onboarding.locationCompletedUsers,1);eq(result.onboarding.locationApprovedUsersNow,2);
eq(result.onboarding.idAccepted,1);eq(result.onboarding.idRejected,1);eq(result.onboarding.idReview,1);eq(result.onboarding.idPendingNow,1);eq(result.onboarding.idExpiredRequests,1);
eq(result.onboarding.banksConnected,2);eq(result.onboarding.banksVerified,1);eq(result.onboarding.banksConnectedNow,2);eq(result.onboarding.bankUsersNow,1);
eq(result.charts[0].deposits,10);eq(result.charts[0].revenue,1);eq(result.charts[0].traffic,null);
assert.ok(result.funnel.every(row=>row.conversionRate==null));checks++;
assert.throws(()=>journalLegs([{...received,total_credit:999}]));checks++;
assert.throws(()=>journalLegs([received,{...received,id:'conflict',legs_json:'[]'}]));checks++;
for(const path of ['base44/functions/getAnalyticsDashboard/entry.ts','src/pages/AdminSiteActivity.jsx']) {
 const output=ts.transpileModule(fs.readFileSync(path,'utf8'),{fileName:path,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 eq((output.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
}

const handlerSource=fs.readFileSync('base44/functions/getAnalyticsDashboard/entry.ts','utf8').replace(/^import .*;\n/gm,'');
let caller={role:'admin',email:'jordangust96@gmail.com'}, failSource=false, reads=0;
const service=new Proxy({}, {get:()=>({filter:async()=>{reads++;if(failSource)throw new Error('unavailable');return [];}})});
let handler;
const apiContext=vm.createContext({
 createClientFromRequest:()=>({auth:{me:async()=>caller},asServiceRole:{entities:service}}),
 computeRange,readAll,buildActivityMetrics,isWalletLocationEvidence:validLocation,PRODUCTION_START:'2026-09-09T22:59:21.815Z',
 Deno:{serve:fn=>{handler=fn;},env:{get:()=>''}},Response,Date,Map,Set,AbortSignal,
});
vm.runInContext(handlerSource,apiContext);
caller=null;eq((await handler({json:async()=>({})})).status,401);eq(reads,0);
caller={role:'user',email:'jordangust96@gmail.com'};eq((await handler({json:async()=>({})})).status,403);
caller={role:'admin',email:'another@example.invalid'};eq((await handler({json:async()=>({})})).status,403);
caller={role:'admin',email:'jordangust96@gmail.com'};
eq((await handler({json:async()=>({preset:'custom',startDate:'invalid',endDate:'invalid'})})).status,400);eq(reads,0);
const healthy=await handler({json:async()=>({preset:'today'})});
eq(healthy.status,200);
const json=await healthy.json();eq(json.ga4,null);eq(json.charts[0].traffic,null);eq(json.internal.depositVolume,0);
assert.equal(JSON.stringify(json).includes('ip_address'),false);checks++;
failSource=true;eq((await handler({json:async()=>({preset:'today'})})).status,500);

const tasks=[], inserted=[];
const analyticsSource=fs.readFileSync('src/lib/deferredAnalytics.js','utf8').replace('export function','function');
const analyticsContext=vm.createContext({
 window:{dataLayer:[],requestAnimationFrame:fn=>tasks.push(fn),setTimeout:(fn)=>{tasks.push(fn);return tasks.length;},addEventListener:()=>{},removeEventListener:()=>{},clearTimeout:()=>{}},
 document:{readyState:'loading',getElementById:id=>inserted.find(s=>s.id===id),createElement:()=>({}),head:{appendChild:el=>inserted.push(el)}}
});
vm.runInContext(analyticsSource,analyticsContext);vm.runInContext('scheduleDeferredAnalytics()',analyticsContext);
tasks.shift()();tasks.shift()();
eq(inserted[0].id,'chessbet-ga4');eq(inserted.length,1);
const pageEvents=[],ref={current:null};let location={pathname:'/play',search:''};
const tracker=fs.readFileSync('src/components/GoogleAnalyticsTracker.jsx','utf8').replace(/^import .*;\n/gm,'').replace('export default function','function');
const trackerContext=vm.createContext({useLocation:()=>location,useRef:()=>ref,useEffect:fn=>fn(),window:{gtag:(...args)=>pageEvents.push(args),location:{href:'https://worldchessbet.com/play'}},document:{title:'ChessBet'}});
vm.runInContext(tracker,trackerContext);
vm.runInContext('GoogleAnalyticsTracker(); GoogleAnalyticsTracker();',trackerContext);
eq(pageEvents.length,1);
location={pathname:'/wallet',search:''};vm.runInContext('GoogleAnalyticsTracker()',trackerContext);eq(pageEvents.length,2);
console.log('PASS: '+checks+' total checks, including authorization, unavailable sources, GA failure, early collector load, and duplicate page-view protection.');

