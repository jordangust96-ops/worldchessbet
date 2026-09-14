import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('/tmp/chessbet-browser-qa/node_modules/playwright');
const origin=process.env.CHALLENGE_QA_ORIGIN || 'http://localhost:5174';
const transformed=await (await fetch(origin+'/src/components/play/CreateChallengeForm.jsx')).text();
const deps=Object.fromEntries([...transformed.matchAll(/\/node_modules\/\.vite\/deps\/([^?" ]+)\?v=([^" ]+)/g)].map(m=>[m[1],m[2]]));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const width of [390,1280])for(const scenario of ['denied','paid','ready']){
const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
await page.addInitScript(({scenario})=>{
const user={id:'qa',role:'user',account_state:'verified'};
const funding={available_to_play:9.25,reserved_for_matches:0};
const calls=[],entities=new Proxy({},{get:()=>({filter:async()=>[],subscribe:()=>()=>{}})});
window.qa={user,scenario,calls,created:null,sdk:{entities,functions:{invoke:async(name,body)=>{
calls.push({name,body});
if(name==='getUserDisplayNames')return {data:{names:{other:'Opponent'}}};
if(name==='manageChallenge'&&body.action==='wallet_summary')return {data:{...funding}};
if(name==='manageChallenge'&&body.action==='create'){
 if(scenario==='denied'&&body.playMode==='money')throw {response:{data:{code:'location_required',error:'Money play is not available from your current location. You can create this as a free match instead.'}}};
 if(body.playMode==='money'){funding.available_to_play=3.25;funding.reserved_for_matches=6;}
 return {data:{path:'/challenge/'+'a'.repeat(32),inviteCode:'a'.repeat(32)}};
}
return {data:{}};
}}}};
},{scenario});
await page.route('**/*',route=>{
 const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
 if(u.pathname==='/__challenge-qa')return route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#111"><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/__challenge-qa.js"></script></body></html>'});
 if(u.pathname==='/__challenge-qa.js'){
 let source='import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;const React=(await import("/node_modules/.vite/deps/react.js")).default;import ReactDOM from "/node_modules/.vite/deps/react-dom_client.js";import {MemoryRouter} from "/node_modules/.vite/deps/react-router-dom.js";import {QueryClient,QueryClientProvider} from "/node_modules/.vite/deps/@tanstack_react-query.js";const Form=(await import("/src/components/play/CreateChallengeForm.jsx")).default;const Header=(await import("/src/components/layout/AccountBalance.jsx")).default;const Ready=(await import("/src/components/play/matchview/ChallengeReadyScreen.jsx")).default;import "/src/index.css";function App(){const [made,setMade]=React.useState(false);return React.createElement("main",{style:{maxWidth:600,margin:"auto",padding:16}},React.createElement(Header),window.qa.scenario==="ready"?React.createElement(Ready,{match:{id:"mock",play_mode:"free",player1_id:"qa",player2_id:"other",preparation_started_at:new Date().toISOString(),wager_amount:0,platform_service_fee:0,display_name:"Blitz (3+0)"},userId:"qa",opponentId:"other"}):made?React.createElement("h1",null,"Challenge created"):React.createElement(Form,{onCreated:()=>setMade(true)}));}ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},React.createElement(MemoryRouter,null,React.createElement(App))));';
 for(const file of ['react.js','react-dom_client.js','react-router-dom.js','@tanstack_react-query.js'])source=source.replaceAll(file+'"',file+'?v='+(deps[file] || deps['react.js'])+'"');
 return route.fulfill({contentType:'text/javascript',body:source});
 }
 if(u.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:'export const base44=window.qa.sdk;'});
 if(u.pathname==='/src/lib/AuthContext.jsx')return route.fulfill({contentType:'text/javascript',body:'export const useAuth=()=>({user:window.qa.user,isAuthenticated:true});'});
 if(u.pathname.startsWith('/api/'))return route.abort();return route.continue();
});
await page.routeWebSocket('**/*',ws=>{if(ws.url().startsWith(origin.replace('http','ws')))ws.connectToServer();else ws.close();});
await page.goto(origin+'/__challenge-qa',{waitUntil:'networkidle'});
if(scenario==='ready'){
 const ready=page.getByRole('button',{name:'I’m Ready',exact:true});
 assert.equal(await ready.isEnabled(),false);
 await page.getByRole('checkbox').check();assert.equal(await ready.isEnabled(),true);
 await ready.click();
 assert.equal(await page.evaluate(()=>window.qa.calls.find(x=>x.body?.action==='ready').body.agree),true);
}else{
 const create=page.getByRole('button',{name:'Create Challenge Link',exact:true});
 await create.waitFor();assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(await create.isEnabled(),true);
 await page.getByRole('button',{name:'Money play',exact:true}).click();
 await page.getByText('Playable balance: $9.25',{exact:true}).waitFor();
 const five=page.getByRole('button',{name:'$5',exact:true}),ten=page.getByRole('button',{name:'$10',exact:true});
 assert.equal(await five.isEnabled(),true);assert.equal(await ten.isEnabled(),false);
 assert.equal(await page.getByRole('checkbox').count(),0);
 assert.doesNotMatch(await page.locator('body').innerText(),/Your location and eligibility are checked automatically|Creating the link reserves no money/);
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(x=>x.body?.action==='create').length),0);
 await create.click();
 if(scenario==='denied'){
   await page.getByRole('button',{name:'Make this a free match',exact:true}).click();
   assert.equal(await create.isEnabled(),true);await create.click();
   await page.getByRole('heading',{name:'Challenge created'}).waitFor();
   const calls=await page.evaluate(()=>window.qa.calls.filter(x=>x.body?.action==='create').map(x=>x.body.playMode));
   assert.deepEqual(calls,['money','free']);
 }else{
   await page.getByText('$6.00 reserved for matches',{exact:true}).waitFor();
   assert.match(await page.locator('[aria-label="View wallet balance, match reservations and pending deposits"]').innerText(),/\$3.25/);
 }
}
assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
console.log('PASS '+scenario+' at '+width+'px; isolated SDK, no real challenge or money movement.');
await context.close();
}
}finally{await browser.close();}
