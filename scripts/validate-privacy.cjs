const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const code=fs.readFileSync(__dirname+'/../public/privacy-bootstrap.js','utf8');let checks=0;
function ok(v,m){assert.ok(v,m);checks++}
function browser({path='/',saved=null,gpc=false,token=false,broken=false}={}){
 const data={};if(saved)data.chessbet_cookie_preferences_v1=JSON.stringify(saved);if(token)data.base44_access_token='test-token';
 const storage=new Proxy({getItem:k=>{if(broken)throw Error();return data[k]??null},setItem:(k,v)=>{if(broken)throw Error();data[k]=String(v)},removeItem:k=>delete data[k]},{ownKeys:()=>Object.keys(data),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
 const calls=[],listeners={},nav=[];const location={search:path.includes('?')?'?private=1':'',hash:path.includes('#')?'#private':'',origin:'https://worldchessbet.com',hostname:'worldchessbet.com',pathname:path,href:'https://worldchessbet.com'+path,assign:u=>nav.push(u),replace:u=>nav.push(u),reload:()=>nav.push('reload')};
 function XHR(){}XHR.prototype.open=function(m,u){calls.push(u)};XHR.prototype.send=function(){calls.push('send')};XHR.prototype.abort=function(){calls.push('abort')};
 const ctx={window:null,document:{cookie:''},navigator:{globalPrivacyControl:gpc,sendBeacon:u=>{calls.push(u);return true}},location,localStorage:storage,sessionStorage:storage,history:{pushState:()=>calls.push('push'),replaceState:()=>calls.push('replace')},XMLHttpRequest:XHR,URL,Response,Event,Date,JSON,Promise,fetch:async u=>{calls.push(u);return new Response(null,{status:200})},addEventListener:(n,f)=>listeners[n]=f,dispatchEvent:e=>listeners[e.type]?.(e)};ctx.window=ctx;vm.runInNewContext(code,ctx);return {ctx,p:ctx.ChessBetPrivacy,calls,data,nav};
}
(async()=>{
let b=browser();ok(!b.p.choice().decided,'fresh choice');ok(!b.p.allowed('analytics'),'default deny');
ok((await b.ctx.fetch('/api/app-logs/app/log-user-in-app/home')).status===204,'platform log blocked');ok((await b.ctx.fetch('/api/runtime/session-recordings/ingest')).status===204,'recording blocked');ok((await b.ctx.fetch('/api/apps/app/analytics/track/batch')).status===204,'platform analytics blocked');
await b.ctx.fetch('/api/apps/app/functions/verifyMfaOtp');ok(b.calls.includes('/api/apps/app/functions/verifyMfaOtp'),'MFA allowed');await b.ctx.fetch('/api/apps/app/entities/Wallet');ok(b.calls.includes('/api/apps/app/entities/Wallet'),'wallet allowed');
b.p.save({analytics:true,marketing:false});ok(b.p.allowed('analytics'),'analytics accepted');ok(!b.p.allowed('marketing'),'partial choice');await b.ctx.fetch('https://www.google-analytics.com/g/collect');ok(b.calls.includes('https://www.google-analytics.com/g/collect'),'GA allowed');ok((await b.ctx.fetch('https://www.facebook.com/tr')).status===204,'Meta denied');b.p.save({analytics:false,marketing:false});ok(!b.p.allowed('analytics'),'withdrawn');
const saved={version:1,savedAt:Date.now(),analytics:true,marketing:true};
for(const path of ['/login','/register','/verify-mfa','/wallet','/play','/profile','/admin/users','/?private=1','/#private']){b=browser({path,saved});ok(!b.p.allowed('analytics')&&!b.p.allowed('marketing'),'sensitive '+path)}
b=browser({saved,gpc:true});ok(!b.p.allowed('analytics')&&!b.p.allowed('marketing'),'GPC overrides stored grants');b.p.save({analytics:true,marketing:true});ok(!b.p.allowed('marketing'),'GPC overrides accept');
b=browser({saved,token:true});ok(!b.p.allowed('analytics'),'signed-in public visit excluded');
b=browser({saved:{...saved,savedAt:Date.now()-181*86400000}});ok(!b.p.choice().decided,'expiry');
b=browser({saved:{...saved,savedAt:Date.now()+86400000}});ok(!b.p.choice().decided,'future timestamp');
b=browser({saved:{...saved,version:0}});ok(!b.p.choice().decided,'old version');
b=browser({broken:true});ok(!b.p.allowed('analytics'),'storage unavailable fail closed');ok(b.p.save({analytics:false,marketing:false})===false,'storage failure reported');ok(b.p.choice().decided,'in-memory choice remembered');
b=browser({saved});b.ctx.__chessbetTrackingLoaded=true;b.ctx.history.pushState({},'', '/wallet');ok(b.nav[0]==='https://worldchessbet.com/wallet','unload trackers before private route');ok(!b.calls.includes('push'),'no unsafe SPA transition');
console.log(checks+' privacy assertions passed');
})().catch(e=>{console.error(e);process.exit(1)});
