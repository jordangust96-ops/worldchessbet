import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('/tmp/chessbet-browser-qa/node_modules/playwright');
const origin=process.env.REMATCH_QA_ORIGIN || 'http://localhost:5174';
const transformed=await(await fetch(origin+'/src/components/play/matchview/RematchControls.jsx')).text();
const reactUrl=transformed.match(/from "([^"]+react\.js\?v=[^"]+)"/)?.[1] || transformed.match(/import[^"\n]*"([^"]+react\.js\?v=[^"]+)"/)?.[1];
assert.ok(reactUrl,'Transformed React dependency found');
const reactDomUrl=reactUrl.replace('react.js','react-dom_client.js');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
for(const width of [390,1280])for(const free of [true,false]) {
 const f=fixture();f.state.now=Date.now();
 if(!free)f.balance('p1',25);
 f.table('Match').push({id:'finished',launch_epoch:2,status:'completed',player1_id:'p1',player2_id:'p2',play_mode:free?'free':'money',wager_amount:free?0:25,platform_service_fee:free?0:2,time_control:'blitz'});
 const control=f.load('base44/shared/rematchControl.ts').exports.rematchControl;
 const context=await browser.newContext({viewport:{width,height:900}}),pages=[],errors=[];
 for(const id of ['p1','p2']) {
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!==origin)return route.abort();
   if(u.pathname==='/__rematch-api') {
    const body=route.request().postDataJSON();f.state.now=Date.now();
    if(body.action==='wallet_summary')return route.fulfill({json:{data:{available_to_play:f.table('Wallet').find(w=>w.user_id===id).available_balance}}});
    try {const data=await control(f.request,f.sdk,f.user(id),body);return route.fulfill({json:{data}});}
    catch(e){return route.fulfill({status:e.status||503,json:{error:e.message,code:e.code}});}
   }
   if(u.pathname==='/__rematch')return route.fulfill({contentType:'text/html',body:'<html><body style="background:#101218"><div id="root"></div><script type="module" src="/__rematch.js"></script></body></html>'});
   if(u.pathname==='/__rematch.js')return route.fulfill({contentType:'text/javascript',body:`
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('${reactUrl}')).default;
    const {createRoot}=(await import('${reactDomUrl}')).default;
    const Controls=(await import('/src/components/play/matchview/RematchControls.jsx')).default;
    import '/src/index.css';
    function App(){const [next,setNext]=React.useState('');const ref=React.useRef();return next?React.createElement('h1',null,next==='left'?'Left results':'Match ready'):React.createElement('main',{style:{maxWidth:500,margin:'auto'}},React.createElement(Controls,{ref,match:{id:'finished'},opponentName:'Opponent',onAccepted:()=>setNext('next')}),React.createElement('button',{onClick:async()=>{await ref.current.leave();setNext('left');}},'Leave results'));}
    createRoot(document.getElementById('root')).render(React.createElement(App));
   `});
   if(u.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:"export const base44={functions:{invoke:async(name,body)=>{const r=await fetch('/__rematch-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error),{response:{data}});return data;}}};"});
   if(u.pathname==='/src/lib/deviceContext.js')return route.fulfill({contentType:'text/javascript',body:'export const getBrowserGeolocation=async()=>({permission:"granted"});export const getDeviceFingerprintHash=async()=>"fixture";'});
   return route.continue();
  });
  await page.goto(origin+'/__rematch');
 }
 const [a,b]=pages;
 await a.getByRole('button',{name:'Request Rematch',exact:true}).waitFor();
 if(!free){
  await a.getByText('You need $27.00 in playable funds to rematch.',{exact:true}).waitFor();
  assert.equal(await a.getByRole('button',{name:'Request Rematch',exact:true}).isEnabled(),false);
  assert.equal(f.table('Match').length,1);f.balance('p1',100);
 }
 // The first result screen learns that the second player arrived on its next poll.
 await a.getByRole('button',{name:'Request Rematch',exact:true}).click({timeout:20000});
 await b.getByRole('button',{name:'Accept Rematch',exact:true}).waitFor({timeout:20000});
 assert.equal(await b.getByRole('button',{name:'Decline',exact:true}).isVisible(),true);
 assert.doesNotMatch(await b.locator('body').innerText(),/Create Rematch Link|Share it|Copy Link/);
 if(!free)assert.match(await b.locator('body').innerText(),/\$27.00 reserved/);
 await b.getByRole('button',{name:'Decline',exact:true}).click();
 await b.getByText('You declined the rematch.',{exact:true}).waitFor({timeout:20000});
 await a.getByText('Opponent declined the rematch.',{exact:true}).waitFor({timeout:20000});
 for(const page of [a,b]) {
  const terminal=page.getByRole('button',{name:'Rematch Declined',exact:true});
  await terminal.waitFor({timeout:20000});assert.equal(await terminal.isEnabled(),false);
  assert.doesNotMatch(await page.locator('body').innerText(),/Waiting for your opponent to connect on the result screen/);
 }
 assert.equal(f.table('Wallet')[0].available_balance,100);
 assert.equal(f.table('Match').length,2);
 assert.deepEqual(errors,[]);
 assert.equal(f.table('Match').filter(m=>m.status==='preparing').length,0);
 if(free){assert.equal(f.state.lookups,0);assert.equal(f.state.creationLookups||0,0);assert.equal(f.table('LedgerJournalBatch').length,0);}
 console.log('PASS two-player '+(free?'free':'paid')+' terminal decline state at '+width+'px');
 await context.close();
}
} finally {await browser.close();}
