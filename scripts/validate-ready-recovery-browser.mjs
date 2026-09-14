import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('/tmp/chessbet-browser-qa/node_modules/playwright');
const origin='http://localhost:5173';
const transformed=await(await fetch(origin+'/src/components/play/matchview/ChallengeReadyScreen.jsx')).text();
const reactUrl=transformed.match(/from "([^"]+react\.js\?v=[^"]+)"/)[1];
const domUrl=reactUrl.replace('react.js','react-dom_client.js'),routerUrl=reactUrl.replace('react.js','react-router-dom.js');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const free of [true,false]){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({free})=>{
  window.qa={free,calls:[],failReady:1,failHeartbeat:1,failFinalize:1,needsReady:false,
   match:{id:'mock',play_mode:free?'free':'money',player1_id:'p1',player2_id:'p2',wager_amount:free?0:5,platform_service_fee:free?0:1,status:'preparing',display_name:'Blitz (3+0)',challenge_start_deadline_at:new Date(Date.now()+300000).toISOString()}};
 },{free});
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/__ready')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/__ready.js"></script>'});
  if(u.pathname==='/__ready.js')return route.fulfill({contentType:'text/javascript',body:`
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   const React=(await import('${reactUrl}')).default;const {createRoot}=(await import('${domUrl}')).default;const {MemoryRouter}=await import('${routerUrl}');
   const Ready=(await import('/src/components/play/matchview/ChallengeReadyScreen.jsx')).default;
   function App(){const [n,setN]=React.useState(0);React.useEffect(()=>{const t=setInterval(()=>setN(x=>x+1),100);return()=>clearInterval(t);},[]);
    return React.createElement(Ready,{match:{...window.qa.match},userId:'p1',opponentId:'p2',onRefresh:async()=>setN(x=>x+1),onCancel:async()=>{}});}
   createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(App)));
  `});
  if(u.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:`
    export const base44={functions:{invoke:async(name,body)=>{
      const q=window.qa;q.calls.push({name,action:body.action,at:Date.now()});
      if(name==='getUserDisplayNames')return {data:{names:{p2:'Other player'}}};
      const action=body.action, key=action==='ready'?'failReady':action==='heartbeat'?'failHeartbeat':action==='finalize'?'failFinalize':'';
      if(q[key]>0){q[key]--;throw Object.assign(new Error('This challenge could not be updated. Please retry; do not start another payment.'),{response:{status:503,data:{action:'retry'}}});}
      if(action==='unready'){q.match.challenge_player1_ready_at='';return {data:{needsReady:true}};}
      if(action==='heartbeat' && q.needsReady)return {data:{needsReady:true,match:{...q.match}}};
      if(action==='ready' || action==='heartbeat'){q.match.challenge_player1_ready_at=new Date().toISOString();return {data:{ready:true,match:{...q.match}}};}
      return {data:{match:{...q.match}}};
    }}};
  `});
  if(u.pathname==='/src/lib/deviceContext.js')return route.fulfill({contentType:'text/javascript',body:"export const getBrowserGeolocation=async()=>{window.qa.location=(window.qa.location||0)+1;return {permission:'granted'};};export const getDeviceFingerprintHash=async()=> 'fixture';"});
  return route.continue();
 });
 await page.routeWebSocket('**/*',ws=>ws.close());await page.goto(origin+'/__ready');
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'I’m Ready',exact:true}).click();
 await page.getByRole('button',{name:'Waiting for opponent…',exact:true}).waitFor();
 for(let i=0;i<35;i++){
   await page.waitForTimeout(200);
   assert.equal(await page.getByRole('button',{name:'Waiting for opponent…',exact:true}).count(),1,'ready must not flicker on fresh timestamps or parent renders');
 }
 const q=await page.evaluate(()=>window.qa);
 assert.equal(q.calls.filter(x=>x.action==='ready').length,2);
 assert.ok(q.calls.filter(x=>x.action==='heartbeat').length<=4,'no refresh-triggered heartbeat storm');
 assert.equal(q.calls.filter(x=>x.action==='finalize').length,2);
 assert.equal(q.location||0,free?0:1);
 assert.doesNotMatch(await page.locator('body').innerText(),/do not start another payment/);
 await page.evaluate(()=>{window.qa.needsReady=true;});
 await page.getByRole('button',{name:'I’m Ready',exact:true}).waitFor();
 await page.getByRole('button',{name:'I’m Ready',exact:true}).click();
 await page.getByRole('button',{name:'Waiting for opponent…',exact:true}).waitFor();
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('button',{name:'I’m Ready',exact:true}).waitFor();
 const before=await page.evaluate(()=>window.qa.calls.filter(x=>x.action==='heartbeat').length);
 await page.waitForTimeout(3300);
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(x=>x.action==='heartbeat').length),before);
 assert.ok(await page.evaluate(()=>window.qa.calls.some(x=>x.action==='unready')));
 assert.deepEqual(errors,[]);
 console.log('PASS '+(free?'free':'paid')+': transient ready/heartbeat/finalize retries, stable readiness, bounded cadence, expiry, visibility withdrawal');
 await page.close();
}
}finally{await browser.close();}
