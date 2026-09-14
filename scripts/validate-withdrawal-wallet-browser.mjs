import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('/tmp/chessbet-browser-qa/node_modules/playwright');
const depsVersion=(await (await fetch('http://localhost:5173/src/main.jsx')).text()).match(/react\.js\?v=([^"]+)/)[1];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
 page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 await page.addInitScript(()=>{
 const wallet={id:'w',user_id:'qa',available_balance:9.25,held_balance:0,total_balance:9.25};
 const user={id:'qa',role:'user',launch_epoch:2,account_state:'verified',full_name:'Test Player'};
 const transactions=[{id:'fee',user_id:'qa',launch_epoch:2,type:'admin_reversal',source_event:'legacy_deposit_fee_adjustment',amount:.75,status:'completed',created_date:'2026-09-14T12:00:00Z',description:'Internal processor and cushion detail must not appear'}];
 const calls=[];
 const entities=new Proxy({},{get:(_,name)=>({filter:async(q={})=>name==='Wallet'?[wallet]:name==='WalletTransaction'?transactions.filter(row=>Object.entries(q).every(([k,v])=>row[k]===v)):[],list:async()=>[],get:async()=>null,subscribe:()=>()=>{}})});
 window.qa={user,calls,sdk:{auth:{me:async()=>user},entities,functions:{invoke:async(name,body)=>{
 calls.push({name,body});
 if(name==='getSeamlessWalletState')return {data:{enabled:true,withdrawals_enabled:true,deposits_enabled:true,hosted_plaid_enabled:true,account_verified:true,account_state:'verified',identity:{verified:true,status:'verified'},onboarding_location:{allowed:true,status:'approved'},funding:{available_to_play:9.25,available_to_withdraw:0,withdrawal_restricted_balance:9.25,next_withdrawal_review_at:'2026-09-16T22:59:21Z'},banks:[{id:'bank',source_id:'source',is_primary:true,status:'verified',account_name:'Test Bank'}],recent:[]}};
 if(name==='submitSeamlessWithdrawal')return {data:{enabled:true,status:'queued',transaction_id:'mock-request',estimated_arrival:'2026-09-23T12:00:00Z'}};
 return {data:{}};
 }}}};
 });
 await page.route('**/*',route=>{
 const u=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(u.pathname==='/__wallet-qa')return route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#111"><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/__wallet-qa.js"></script></body></html>'});
 if(u.pathname==='/__wallet-qa.js')return route.fulfill({contentType:'text/javascript',body:'import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;const React=(await import("/node_modules/.vite/deps/react.js")).default;import ReactDOM from "/node_modules/.vite/deps/react-dom_client.js";import {MemoryRouter} from "/node_modules/.vite/deps/react-router-dom.js";const WalletPage=(await import("/src/pages/WalletPage.jsx")).default;import "/src/index.css";ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(MemoryRouter,null,React.createElement(WalletPage)));'.replaceAll('react.js"','react.js?v='+depsVersion+'"').replaceAll('react-dom_client.js"','react-dom_client.js?v='+depsVersion+'"').replaceAll('react-router-dom.js"','react-router-dom.js?v='+depsVersion+'"')});
 if(u.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:'export const base44=window.qa.sdk;'});
 if(u.pathname==='/src/lib/AuthContext.jsx')return route.fulfill({contentType:'text/javascript',body:'export const useAuth=()=>({user:window.qa.user,isAuthenticated:true});'});
 if(u.pathname.startsWith('/api/'))return route.abort();
 return route.continue();
 });
 await page.routeWebSocket('**/*',ws=>{if(!ws.url().includes('localhost'))ws.close();else ws.connectToServer();});
 await page.goto('http://localhost:5173/__wallet-qa',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'$9.25',exact:true}).waitFor();
 assert.doesNotMatch(await page.locator('body').innerText(),/bank withdrawal hold|Next review:/i);
 await page.getByRole('button',{name:/Deposit Fee.*0.75/}).click();
 assert.match(await page.locator('body').innerText(),/Deposit fee: \$0.75\./);
 assert.doesNotMatch(await page.locator('body').innerText(),/cushion|Internal processor/i);
 await page.getByRole('button',{name:'Withdraw',exact:true}).click();
 await page.getByRole('spinbutton').fill('9.25');
 const request=page.getByRole('button',{name:'Request $9.25 withdrawal',exact:true});
 assert.equal(await request.isEnabled(),true);
 await request.click();
 await page.getByRole('status').filter({hasText:'Withdrawal requested.'}).waitFor();
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(x=>x.name==='submitSeamlessWithdrawal').length),1);
 assert.deepEqual(errors,[]);
 console.log('PASS isolated Wallet display and mocked request at '+width+'px; no real user, provider call, or email.');
 await context.close();
 }
}finally{await browser.close();}
