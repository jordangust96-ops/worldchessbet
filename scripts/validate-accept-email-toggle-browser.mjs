import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('/tmp/chessbet-browser-qa/node_modules/playwright');
const origin='http://localhost:5173';
const transformed=await(await fetch(origin+'/src/components/play/NotifyOnAcceptToggle.jsx')).text();
const reactUrl=transformed.match(/from "([^"]+react\.js\?v=[^"]+)"/)[1];
const domUrl=reactUrl.replace('react.js','react-dom_client.js');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const width of [390,1280])for(const free of [true,false]){
 const f=fixture(),m=free?(await f.api.createChallenge(f.sdk,f.user('p1'),{playMode:'free',creationVersion:f.policy.CHALLENGE_CREATION_VERSION,entryAmount:0,serviceFee:0,requestKey:'browser_email_free_123'})).match:await f.create();
 const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),errors=[];
 let fail=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/__notify-api'){
   if(fail)return route.fulfill({status:503,json:{error:'test failure'}});
   try{return route.fulfill({json:await f.makeSdk('p1').functions.invoke('updateMatchPreference',route.request().postDataJSON())});}
   catch(e){return route.fulfill({status:e.response?.status||500,json:e.response?.data||{error:'failed'}});}
  }
  if(u.pathname==='/__notify-state')return route.fulfill({json:{id:m.id,notify_on_accept:f.get(m.id).notify_on_accept}});
  if(u.pathname==='/__notify')return route.fulfill({contentType:'text/html',body:'<html><body style="background:#111"><div id="root"></div><script type="module" src="/__notify.js"></script></body></html>'});
  if(u.pathname==='/__notify.js')return route.fulfill({contentType:'text/javascript',body:`
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   const React=(await import('${reactUrl}')).default;const {createRoot}=(await import('${domUrl}')).default;
   const Toggle=(await import('/src/components/play/NotifyOnAcceptToggle.jsx')).default;import '/src/index.css';
   const initial=await(await fetch('/__notify-state')).json();
   function App(){const [match,setMatch]=React.useState(initial);return React.createElement('main',{style:{maxWidth:500,padding:24}},React.createElement(Toggle,{match,onChanged:async()=>setMatch(await(await fetch('/__notify-state')).json())}));}
   createRoot(document.getElementById('root')).render(React.createElement(App));
  `});
  if(u.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:"export const base44={functions:{invoke:async(name,body)=>{const r=await fetch('/__notify-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error('failed');return data;}}};"});
  return route.continue();
 });
 await page.routeWebSocket('**/*',ws=>ws.close());
 await page.goto(origin+'/__notify');
 const toggle=page.getByRole('switch',{name:'Email me when accepted'});
 await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');
 await toggle.click();await page.locator('[role="switch"]:not([disabled])').waitFor();
 assert.equal(f.get(m.id).notify_on_accept,false);
 await page.reload();await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');
 await toggle.click();await page.locator('[role="switch"]:not([disabled])').waitFor();assert.equal(f.get(m.id).notify_on_accept,true);
 fail=true;await toggle.click();await page.getByRole('alert').waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');
 assert.deepEqual(errors,[]);assert.equal(f.state.emails.length,0);
 console.log('PASS '+(free?'free':'paid')+' '+width+'px default on, saved off after reload, on, failed-save rollback');
 await context.close();
}
}finally{await browser.close();}
