import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
// Isolated browser QA dependency lives outside the application dependency tree.
const { chromium } = require('/tmp/chessbet-browser-qa/node_modules/playwright');
const browser = await chromium.launch({ headless:true, args:['--no-sandbox'] });
const code = 'a'.repeat(32);
let checks=0;
const failures=[];
async function scenario(name,{who=null,funded=false,status='open',width=390,path=`/challenge/${code}`}={},work){
  const context=await browser.newContext({viewport:{width,height:844}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // All backend calls use an in-browser mock; all outbound requests are
  // blocked. This suite never creates real accounts, contests or payments.
  await context.addInitScript(({who,funded,status,code})=>{
    const user=who?{id:who,role:'user',launch_epoch:2,mfa_bypass:true,account_state:'verified',chess_com_username:who,full_name:'Test Player'}:null;
    const match={id:'qa-match',launch_epoch:2,challenge_version:1,player1_id:'p1',...(status==='claimed'?{player2_id:'p2'}:{}),wager_amount:25,platform_service_fee:2,platform_fee_schedule_version:'2026-07-28',time_control:'blitz',display_name:'Blitz (5+0)',clock_initial_ms:300000,status:status==='claimed'?'preparing':status==='open'?'searching':'cancelled',is_private:true,invite_code:code,player1_certified:status==='claimed',player2_certified:status==='claimed',player1_deposited:status==='claimed',player2_deposited:status==='claimed',preparation_started_at:new Date().toISOString(),challenge_expires_at:new Date(Date.now()+86400000).toISOString()};
    const card=()=>({id:match.id,creatorName:'Jordan',entryAmount:25,serviceFee:2,totalRequired:27,winnerAward:50,displayName:match.display_name,expiresAt:match.challenge_expires_at,status:match.status==='searching'?'open':match.status==='preparing'?'claimed':'cancelled',creatorReady:true,creatorReadyUntil:new Date(Date.now()+119000).toISOString()});
    const wallet={id:'qa-wallet',user_id:who,balance:funded?100:0,available_balance:funded?100:0,held_balance:status==='claimed'?27:0,total_balance:funded?100:0};
    const calls=[];
    const listeners=[];
    const update=patch=>{Object.assign(match,patch);listeners.forEach(fn=>fn({type:'update',data:{...match}}));};
    const rows=(entity,query={})=>{
      if(entity==='Wallet')return [{...wallet}];
      if(entity==='Match')return Object.entries(query).every(([key,value])=>{
        if(value && typeof value==='object'){if('$in'in value)return value.$in.includes(match[key]);if('$ne'in value)return match[key]!==value.$ne;return true;}
        return match[key]===value;
      })?[{...match}]:[];
      return [];
    };
    const entity=new Proxy({}, {get:(_,name)=>({filter:async q=>rows(name,q),get:async id=>name==='Match'?{...match}:name==='Wallet'?{...wallet}:{id},list:async()=>rows(name),subscribe:fn=>{listeners.push(fn);return()=>{};},update:async()=>{throw Error('Unexpected client entity write during QA');},create:async()=>{throw Error('Unexpected client entity creation during QA');}})});
    const sdk={auth:{me:async()=>{if(!user)throw Object.assign(Error('unauthorized'),{status:401});return user;},isAuthenticated:async()=>!!user,updateMe:async patch=>({...user,...patch})},entities:entity,
      analytics:{track:()=>{}},appLogs:{logUserInApp:async()=>{}},
      functions:{invoke:async(name,body={})=>{
        calls.push({name,body});
        if(name==='manageChallenge'){
          if(body.action==='view')return {data:{challenge:card(),role:who==='p1'?'player1':who==='p2'&&match.player2_id?'player2':'',participant:who==='p1'||(who==='p2'&&!!match.player2_id)}};
          if(body.action==='list')return {data:{challenges:who==='p1'&&match.status==='searching'?[{...card(),inviteCode:code,path:'/challenge/'+code}]:[]}};
          if(body.action==='create'){const tc={blitz:['Blitz (3+0)',180000],rapid:['Rapid (10+0)',600000],classical:['Classical (15+0)',900000]}[body.timeControl];update({time_control:body.timeControl,display_name:tc[0],clock_initial_ms:tc[1]});return {data:{match:{...match},inviteCode:code,path:'/challenge/'+code}};}
          if(body.action==='readiness')return {data:funded?{ready:true,availableBalance:100,totalRequired:27}:{ready:false,code:'funds_required',reason:'Your wallet needs enough available funds. Pending funds do not count.',availableBalance:0,totalRequired:27}};
          if(body.action==='remember')return {data:{remembered:true,reserved:false}};
          if(body.action==='intent')return {data:{intent:null}};
          if(body.action==='authorize')return {data:{challenge:card(),authorizedUntil:new Date(Date.now()+120000).toISOString()}};
          if(body.action==='accept'){update({status:'preparing',player2_id:'p2',player1_deposited:true,player2_deposited:true,player1_certified:true,player2_certified:true});return {data:{match:{...match},accepted:true}};}
          if(body.action==='ready'){update({[who==='p1'?'challenge_player1_ready_at':'challenge_player2_ready_at']:new Date().toISOString()});return {data:{match:{...match},ready:true}};}
          if(body.action==='heartbeat')return {data:{match:{...match},ready:true}};
          if(body.action==='finalize')return {data:{match:{...match},waitingForReady:true}};
          if(body.action==='cancel'){update({status:'cancelled'});return {data:{match:{...match}}};}
          if(body.action==='ping')return {data:{notified:true}};
          if(body.action==='recover')return {data:{match:{...match}}};
        }
        if(name==='ensureWallet')return {data:{wallet:{...wallet}}};
        if(name==='getUserDisplayNames')return {data:{names:{p1:'Jordan',p2:'Opponent'}}};
        if(name==='getLaunchAvailability')return {data:{paid_contests_enabled:true,deposits_enabled:true}};
        if(name==='getAvailableMatches')return {data:{matches:[]}};
        if(name==='validateMfaSession')return {data:{valid:true}};
        if(name==='getSeamlessWalletState')return {data:{enabled:true,deposits_enabled:true,withdrawals_enabled:true,identity:{status:'verified'},bank_accounts:[]}};
        if(name==='getMyRating')return {data:{rating:null}};
        if(name==='getLiveStats')return {data:{onlineCount:0,activeMatches:0}};
        if(['submitSeamlessDeposit','submitSeamlessWithdrawal','lockWager','createMatch','acceptMatch'].includes(name))throw Error('Unexpected real-money/legacy action '+name);
        return {data:{}};
      }} };
    window.__challengeQA={user,match,wallet,calls,sdk};
    if(who)localStorage.setItem('base44_access_token','isolated-browser-fixture-not-a-real-token');
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(_ok,fail)=>fail({code:1})}});
  },{who,funded,status,code});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:500,contentType:'application/json',body:'{"error":"Unexpected backend access in isolated browser QA"}'});
    if(url.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:'export const base44 = window.__challengeQA.sdk;'});
    if(url.pathname==='/src/lib/AuthContext.jsx')return route.fulfill({contentType:'text/javascript',body:`export const AuthProvider=({children})=>children; export const useAuth=()=>({user:window.__challengeQA.user,isAuthenticated:!!window.__challengeQA.user,isLoadingAuth:false,isLoadingPublicSettings:false,authChecked:true,authError:null,checkUserAuth:()=>{},navigateToLogin:()=>{},logout:()=>{}});`});
    return route.continue();
  });
  await page.routeWebSocket('**/*',ws=>{if(!ws.url().includes('localhost:5173'))ws.close();else ws.connectToServer();});
  try{
    await page.goto('http://localhost:5173'+path,{waitUntil:'networkidle',timeout:30000});
    await work(page);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,`${name}: horizontal overflow`);checks++;
    assert.deepEqual(errors,[],`${name}: uncaught browser exceptions`);checks++;
    fs.mkdirSync('/tmp/chessbet-challenge-screenshots',{recursive:true});
    await page.screenshot({path:`/tmp/chessbet-challenge-screenshots/${name}.png`,fullPage:true});
    console.log('PASS '+name);
  }catch(error){failures.push(name);console.log('FAIL '+name+': '+error.message);console.log((await page.locator('body').innerText()).slice(0,1800));console.log(errors);}
  finally{await context.close();}
}
try{
  await scenario('anonymous-preview',{},async page=>{
    await page.getByRole('heading',{name:'Jordan’s challenge'}).waitFor();checks++;
    assert.equal(new URL(page.url()).pathname,'/challenge/'+code);checks++;
    await page.getByRole('button',{name:'Accept Challenge',exact:true}).click();
    await page.waitForURL('**/register?**');checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),0);checks++;
  });
  await scenario('pending-funds-no-claim',{who:'p2'},async page=>{
    await page.getByRole('button',{name:'Accept Challenge',exact:true}).click();
    await page.getByRole('heading',{name:'Available funds required'}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),0);checks++;
    await page.getByText('another eligible player may accept first.',{exact:false}).waitFor();checks++;
  });
  await scenario('unfunded-create',{who:'p1',path:'/play'},async page=>{
    await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
    await page.waitForURL('**/challenge/'+code);checks++;
    await page.getByRole('button',{name:'Share',exact:true}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept'||c.name.startsWith('submitSeamless')).length),0);checks++;
  });
  await scenario('funded-recipient-accept',{who:'p2',funded:true},async page=>{
    await page.getByRole('button',{name:'Accept Challenge',exact:true}).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Accept & Reserve $27.00',exact:true}).click();
    await page.waitForURL('**/play?match=qa-match');checks++;
    await page.getByRole('heading',{name:'Ready to play?'}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),1);checks++;
    assert.equal(await page.getByText('Agree & Reserve $27.00',{exact:true}).count(),0);checks++;
  });
  await scenario('creator-readiness-desktop',{who:'p1',funded:true,width:1280},async page=>{
    await page.getByRole('heading',{name:'Your challenge is ready'}).waitFor();checks++;
    await page.getByRole('button',{name:'Copy Link',exact:true}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),0);checks++;
  });
  await scenario('closed-link-recovery',{who:'p2',funded:true,status:'closed'},async page=>{
    await page.getByRole('heading',{name:'This challenge was cancelled'}).waitFor();checks++;
    await page.getByRole('link',{name:'Create a Challenge →'}).waitFor();checks++;
    assert.equal(await page.getByRole('button',{name:'Accept Challenge',exact:true}).count(),0);checks++;
  });
  await scenario('claimed-ready-no-second-reservation',{who:'p2',funded:true,status:'claimed',path:'/play?match=qa-match'},async page=>{
    await page.getByRole('heading',{name:'Ready to play?'}).waitFor();checks++;
    await page.getByRole('button',{name:'I’m Ready',exact:true}).click();
    await page.getByText('Waiting for opponent…',{exact:true}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept'||c.name==='lockWager').length),0);checks++;
  });
  for (const [value,label,minutes] of [['blitz','Blitz',3],['rapid','Rapid',10],['classical','Classical',15]]) {
    await scenario('create-'+value,{who:'p1',path:'/play',width:value==='rapid'?1280:390},async page=>{
      await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
      await page.getByRole('radio',{name:label+' '+minutes+' min',exact:true}).check();
      assert.equal(await page.getByText('The winner award includes both entry amounts; the fee is separate.',{exact:false}).count(),0);checks++;
      await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
      await page.waitForURL('**/challenge/'+code);
      await page.getByText(label+' ('+minutes+'+0) · No increment',{exact:true}).waitFor();checks++;
      assert.equal(await page.evaluate(()=>window.__challengeQA.calls.find(c=>c.body.action==='create').body.timeControl),value);checks++;
    });
  }
}finally{await browser.close();}
console.log(JSON.stringify({checks,scenarios:10,failed:failures,screenshots:'/tmp/chessbet-challenge-screenshots'},null,2));
process.exitCode=failures.length?1:0;
