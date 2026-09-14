import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('/tmp/chessbet-browser-qa/node_modules/playwright');
const origin='http://localhost:5173';
const transformed=await(await fetch(origin+'/src/components/play/ChallengeHub.jsx')).text();
const reactUrl=transformed.match(/from "([^"]+react\.js\?v=[^"]+)"/)[1];
const domUrl=reactUrl.replace('react.js','react-dom_client.js'),routerUrl=reactUrl.replace('react.js','react-router-dom.js');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const scenario of ['cancel-retry','cancel-persistent','cancel-failed','cancel-processing','initial-failure','stale-read']){
 const width=390,free=false,status='open';
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({free,status,scenario})=>{
  const code='a'.repeat(32);
  window.qa={scenario,calls:0,fail:scenario==='initial-failure',card:{id:'test',inviteCode:code,path:'/challenge/'+code,playMode:free?'free':'money',status,entryAmount:free?0:5,serviceFee:free?0:1,totalRequired:free?0:6,winnerAward:free?0:10,displayName:'Blitz (3+0)',publiclyListed:true,creatorFundsReserved:!free && status==='open',creatorPresenceRequired:false,notifyOnAccept:true},shared:null,copied:null};
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.qa.shared=data;}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.qa.copied=text;}}});
 },{free,status,scenario});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/__card')return route.fulfill({contentType:'text/html',body:'<html><body style="background:#111"><div id="root"></div><script type="module" src="/__card.js"></script></body></html>'});
  if(u.pathname==='/__card.js')return route.fulfill({contentType:'text/javascript',body:`
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   const React=(await import('${reactUrl}')).default;const {createRoot}=(await import('${domUrl}')).default;const {MemoryRouter}=await import('${routerUrl}');
   const Hub=(await import('/src/components/play/ChallengeHub.jsx')).default;import '/src/index.css';
   createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement('main',{style:{maxWidth:620,margin:'auto'}},React.createElement(Hub,{userId:'host',balance:10}))));
  `});
  if(u.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:`
   const q=window.qa;
   const failure=()=>Object.assign(new Error('This challenge could not be updated. Please retry; do not start another payment.'),{response:{status:503}});
   export const base44={entities:{Match:{filter:async()=>[],subscribe:fn=>{q.event=fn;return()=>{};}}},functions:{invoke:async(name,body)=>{
     if(body.action==='cancel'){
       if(q.scenario==='cancel-failed')throw failure();
       if(q.scenario==='cancel-processing')return {data:{processing:true,match:{id:'test',status:'cancelling'}}};
       q.fail=true;return {data:{match:{id:'test',status:'cancelled'}}};
     }
     if(body.action==='list'){
       q.calls++;
       if(q.scenario==='stale-read' && q.calls===2)await new Promise(resolve=>{q.releaseStale=resolve;});
       if(q.fail){if(q.scenario==='cancel-retry')q.fail=false;throw failure();}
       return {data:{challenges:[q.card]}};
     }
     return {data:{}};
   }}};
  `});
  if(['/src/components/play/LiveStatsBar.jsx','/src/components/play/ChallengePanel.jsx','/src/components/play/CreateChallengeForm.jsx','/src/components/play/AvailableMatchSection.jsx','/src/components/play/ActiveChallengeCard.jsx','/src/components/play/ChallengeAvailability.jsx'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:'export default function Stub(){return null;}'});
  return route.continue();
 });
 await page.routeWebSocket('**/*',ws=>ws.close());
 await page.goto(origin+'/__card');
 if(scenario==='initial-failure'){
   await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Create Challenge',exact:true}).count(),0);
   await page.evaluate(()=>window.qa.fail=false);
   await page.getByRole('button',{name:'Retry',exact:true}).click();
   await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();
 }else{
   await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();
   if(scenario==='stale-read'){
     await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
     await page.waitForFunction(()=>window.qa.releaseStale);
   }
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   if(['cancel-failed','cancel-processing'].includes(scenario)){
     await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();
     assert.equal(await page.getByRole('button',{name:'Create Challenge',exact:true}).count(),0);
     if(scenario==='cancel-failed')assert.match(await page.locator('body').innerText(),/do not start another payment/);
   }else{
     await page.getByRole('button',{name:'Create Challenge',exact:true}).waitFor();
     if(scenario==='cancel-persistent' || scenario==='stale-read'){
       await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
       if(scenario==='stale-read')await page.evaluate(()=>{window.qa.fail=false;window.qa.releaseStale();});
       await page.evaluate(()=>window.qa.fail=false);
       await page.getByRole('button',{name:'Retry',exact:true}).click();
     }
     await page.waitForFunction(()=>window.qa.calls>=3);
     assert.equal(await page.getByRole('button',{name:'Create Challenge',exact:true}).isVisible(),true);
     assert.equal(await page.locator('article').count(),0);
     assert.doesNotMatch(await page.locator('body').innerText(),/do not start another payment/);
   }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS '+scenario);
 await context.close();
}
}finally{await browser.close();}