import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('/tmp/chessbet-browser-qa/node_modules/playwright');
const origin=process.env.CHALLENGE_QA_ORIGIN || 'http://localhost:5173';
const deps={};
for(const path of ['ChallengePanel','AvailableMatchSection']){
 const s=await(await fetch(origin+'/src/components/play/'+path+'.jsx')).text();
 for(const m of s.matchAll(/\/node_modules\/\.vite\/deps\/([^?" ]+)\?v=([^" ]+)/g))deps[m[1]]=m[2];
}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const width of [390,1280])for(const scenario of ['invite','marketplace','paid','paid_accept','waiting']){
const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
await page.addInitScript(({scenario})=>{
 const calls=[],code='a'.repeat(32),free=!['paid','paid_accept','waiting'].includes(scenario);
 const card={id:'mock',inviteCode:code,status:'open',playMode:free?'free':'money',creatorName:'Host',displayName:'Blitz (3+0)',entryAmount:free?0:5,serviceFee:free?0:1,totalRequired:6,expiresAt:new Date(Date.now()+86400000).toISOString(),creatorPresenceRequired:false,creatorReady:false};
 window.qa={scenario,calls,user:{id:'recipient'},sdk:{entities:new Proxy({},{get:()=>({filter:async()=>[],subscribe:()=>()=>{}})}),functions:{invoke:async(name,body)=>{
 calls.push({name,body});
 if(name==='getAvailableMatches')return {data:{matches:[{id:'mock',opponentName:'Host',play_mode:'free',wager_amount:0,platform_service_fee:0,challengePath:'/challenge/'+code}]}};
 if(body.action==='view')return {data:{role:'visitor',challenge:{...card,creatorReady:Math.random()>.5,creatorReadyUntil:new Date(Date.now()+1000).toISOString()}}};
 if(body.action==='readiness')return {data:scenario==='paid_accept'?{ready:true}:{ready:false,code:'bank_required',reason:'Connect your bank.'}};
 if(body.action==='accept'){await new Promise(r=>setTimeout(r,1500));return {data:{accepted:true,match:{id:'mock'}}};}
 return {data:{}};
 }}}};
},{scenario});
await page.route('**/*',route=>{
const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
if(u.pathname==='/__free-qa')return route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div><script type="module" src="/__free-qa.js"></script></body></html>'});
if(u.pathname==='/__free-qa.js'){
let s='import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;const React=(await import("/node_modules/.vite/deps/react.js")).default;const {createRoot}=(await import("/node_modules/.vite/deps/react-dom_client.js")).default;const {MemoryRouter,useLocation}=await import("/node_modules/.vite/deps/react-router-dom.js");const {HelmetProvider}=await import("/node_modules/.vite/deps/react-helmet-async.js");const Panel=(await import("/src/components/play/ChallengePanel.jsx")).default;const Market=(await import("/src/components/play/AvailableMatchSection.jsx")).default;const Ready=(await import("/src/components/play/matchview/ChallengeReadyScreen.jsx")).default;import "/src/index.css";function App(){const location=useLocation();return location.search.includes("match=")?React.createElement("h1",null,"Ready screen reached"):React.createElement("main",{style:{maxWidth:600,margin:"auto"}},window.qa.scenario==="waiting"?React.createElement(Ready,{match:{id:"mock",play_mode:"money",player1_id:"host",player2_id:"recipient",wager_amount:5,platform_service_fee:1,preparation_started_at:new Date().toISOString(),challenge_start_deadline_at:new Date(Date.now()+300000).toISOString()},userId:"recipient",opponentId:"host",onCancel:async()=>{}}):window.qa.scenario==="marketplace"?React.createElement(Market,{userId:"recipient",balance:0}):React.createElement(Panel,{inviteCode:"a".repeat(32),embedded:true}));}createRoot(document.getElementById("root")).render(React.createElement(HelmetProvider,null,React.createElement(MemoryRouter,{initialEntries:["/play?accept=1"]},React.createElement(App))));';
for(const file of ['react.js','react-dom_client.js','react-router-dom.js','react-helmet-async.js'])s=s.replaceAll(file+'"',file+'?v='+(deps[file]||deps['react.js'])+'"');
return route.fulfill({contentType:'text/javascript',body:s});
}
if(u.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:'export const base44=window.qa.sdk;'});
if(u.pathname==='/src/lib/deviceContext.js')return route.fulfill({contentType:'text/javascript',body:'export const getBrowserGeolocation=async()=>({permission:"granted"});export const getDeviceFingerprintHash=async()=>"fixture";'});
if(u.pathname==='/src/lib/AuthContext.jsx')return route.fulfill({contentType:'text/javascript',body:'export const useAuth=()=>({user:window.qa.user,isAuthenticated:true});'});
if(u.pathname.startsWith('/api/'))return route.abort();return route.continue();
});
await page.routeWebSocket('**/*',ws=>ws.close());
await page.goto(origin+'/__free-qa',{waitUntil:'networkidle'});
if(scenario==='waiting'){
 await page.getByText('Ready to play?',{exact:true}).waitFor();
 assert.match(await page.getByLabel('Time remaining to start').innerText(),/^[45]:[0-5][0-9]$/);
 assert.match(await page.locator('body').innerText(),/five minutes/);
 assert.equal(await page.getByRole('button',{name:'I’m Ready',exact:true}).isEnabled(),false);
 await page.getByRole('checkbox').check();assert.equal(await page.getByRole('button',{name:'I’m Ready',exact:true}).isEnabled(),true);
}else if(scenario==='paid_accept'){
 await page.getByRole('checkbox').waitFor();await page.getByRole('checkbox').check();
 const accept=page.getByRole('button',{name:'Accept & Reserve $6.00',exact:true});assert.equal(await accept.isEnabled(),true);
 assert.doesNotMatch(await page.locator('body').innerText(),/Waiting for the creator|Notify Creator/);
 await accept.click();await page.getByRole('heading',{name:'Ready screen reached'}).waitFor();
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(x=>x.body.action==='accept').length),1);
}else if(scenario==='paid'){
 await page.getByRole('button',{name:'Open Wallet Setup'}).waitFor();
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(x=>x.body.action==='readiness').length),1);
}else{
 const accept=page.getByRole('button',{name:'Accept Challenge',exact:true});await accept.waitFor();
 const box=await accept.boundingBox();
 await page.waitForTimeout(3400);
 assert.deepEqual(await accept.boundingBox(),box);
 assert.equal(await page.getByRole('checkbox').count(),0);
 assert.doesNotMatch(await page.locator('body').innerText(),/Money play requires|Complete your setup|Checking your eligibility|Official Rules|Pending deposits/);
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(x=>x.body.action==='readiness').length),0);
 await accept.click();assert.equal(await page.getByRole('button',{name:/Joining|Accept Challenge/}).isEnabled(),false);
 await page.getByRole('heading',{name:'Ready screen reached'}).waitFor();
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(x=>x.body.action==='accept').length),1);
}
assert.deepEqual(errors,[]);console.log('PASS '+scenario+' '+width+'px');await context.close();
}
}finally{await browser.close();}