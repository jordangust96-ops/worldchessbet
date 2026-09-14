import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('/tmp/chessbet-browser-qa/node_modules/playwright');
const origin='http://localhost:5173';
const transformed=await(await fetch(origin+'/src/components/play/ChallengeHub.jsx')).text();
const reactUrl=transformed.match(/from "([^"]+react\.js\?v=[^"]+)"/)[1];
const domUrl=reactUrl.replace('react.js','react-dom_client.js'),routerUrl=reactUrl.replace('react.js','react-router-dom.js');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const width of [390,1280])for(const free of [true,false])for(const status of ['open','processing']){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({free,status})=>{
  const code='a'.repeat(32);
  window.qa={card:{id:'test',inviteCode:code,path:'/challenge/'+code,playMode:free?'free':'money',status,entryAmount:free?0:5,serviceFee:free?0:1,totalRequired:free?0:6,winnerAward:free?0:10,displayName:'Blitz (3+0)',publiclyListed:true,creatorFundsReserved:!free && status==='open',creatorPresenceRequired:false,notifyOnAccept:true},shared:null,copied:null};
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.qa.shared=data;}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.qa.copied=text;}}});
 },{free,status});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/__card')return route.fulfill({contentType:'text/html',body:'<html><body style="background:#111"><div id="root"></div><script type="module" src="/__card.js"></script></body></html>'});
  if(u.pathname==='/__card.js')return route.fulfill({contentType:'text/javascript',body:`
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   const React=(await import('${reactUrl}')).default;const {createRoot}=(await import('${domUrl}')).default;const {MemoryRouter}=await import('${routerUrl}');
   const Hub=(await import('/src/components/play/ChallengeHub.jsx')).default;import '/src/index.css';
   createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement('main',{style:{maxWidth:620,margin:'auto'}},React.createElement(Hub,{userId:'host',balance:10}))));
  `});
  if(u.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:"export const base44={entities:{Match:{filter:async()=>[],subscribe:()=>()=>{}}},functions:{invoke:async(name,body)=>({data:body.action==='list'?{challenges:[window.qa.card]}:{}})}};"});
  if(['/src/components/play/LiveStatsBar.jsx','/src/components/play/ChallengePanel.jsx','/src/components/play/CreateChallengeForm.jsx','/src/components/play/AvailableMatchSection.jsx','/src/components/play/ActiveChallengeCard.jsx','/src/components/play/ChallengeAvailability.jsx'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:'export default function Stub(){return null;}'});
  return route.continue();
 });
 await page.routeWebSocket('**/*',ws=>ws.close());
 await page.goto(origin+'/__card');
 await page.getByRole('button',{name:'Share',exact:true}).waitFor();
 const article=page.locator('article');
 assert.match(await article.innerText(),status==='open'?/Waiting for an opponent/:/Pending/);
 assert.doesNotMatch(await article.innerText(),/Confirming|Open Match|service fee ·|required per player/);
 assert.equal(await article.getByRole('link',{name:'Open Match'}).count(),0);
 await page.getByRole('button',{name:'Share',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.qa.shared.url),origin+'/challenge/'+'a'.repeat(32));
 await page.getByRole('button',{name:'Copy challenge URL only',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.qa.copied),origin+'/challenge/'+'a'.repeat(32));
 assert.equal(await page.getByRole('switch',{name:'Email me when accepted'}).isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS '+(free?'free':'money')+' '+status+' '+width+'px sharing, copy, label, no repeated fees or Open Match');
 await context.close();
}
}finally{await browser.close();}
