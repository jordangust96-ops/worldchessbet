import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
// Isolated browser QA dependency lives outside the application dependency tree.
const { chromium } = require('/tmp/chessbet-browser-qa/node_modules/playwright');
const browser = await chromium.launch({ headless:true, args:['--no-sandbox'] });
const qaOrigin=process.env.CHALLENGE_QA_ORIGIN || 'http://localhost:5173';
const code = 'a'.repeat(32);
let checks=0, scenarios=0;
const failures=[];
async function scenario(name,{who=null,funded=false,free=false,status='open',hasChallenge=true,creatorReady=true,needsConsent=false,publiclyListed=false,width=390,path=`/challenge/${code}`}={},work){
  if(process.env.CHALLENGE_SCENARIO && name!==process.env.CHALLENGE_SCENARIO)return;
  scenarios++;
  const context=await browser.newContext({viewport:{width,height:844}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // All backend calls use an in-browser mock; all outbound requests are
  // blocked. This suite never creates real accounts, contests or payments.
  await context.addInitScript(({who,funded,free,status,code,hasChallenge,creatorReady,needsConsent,publiclyListed})=>{
    const user=who?{id:who,role:'user',launch_epoch:2,mfa_bypass:true,account_state:'verified',chess_com_username:who,full_name:'Test Player'}:null;
    const match={play_mode:free?'free':'money',challenge_publicly_listed:publiclyListed,id:'qa-match',launch_epoch:2,challenge_version:1,player1_id:'p1',...(['claimed','completed','live','scheduled'].includes(status)?{player2_id:'p2'}:{}),wager_amount:free?0:25,platform_service_fee:free?0:2,platform_fee_schedule_version:'2026-07-28',time_control:'blitz',display_name:'Blitz (5+0)',clock_initial_ms:300000,status:['live','scheduled'].includes(status)?'in_progress':status==='completed'?'completed':status==='claimed'?'preparing':status==='open'?'searching':'cancelled',is_private:true,invite_code:code,player1_certified:status==='claimed',player2_certified:status==='claimed',player1_deposited:status==='claimed',player2_deposited:status==='claimed',preparation_started_at:new Date().toISOString(),challenge_expires_at:new Date(Date.now()+86400000).toISOString()};
    const card=()=>({playMode:match.play_mode,creatorConsentRequired:needsConsent,isRematch:Boolean(match.challenge_rematch_of),publiclyListed:match.challenge_publicly_listed,id:match.id,creatorName:'Jordan',entryAmount:match.wager_amount,serviceFee:match.platform_service_fee,totalRequired:match.wager_amount+match.platform_service_fee,winnerAward:match.wager_amount*2,displayName:match.display_name,expiresAt:match.challenge_expires_at,status:match.status==='searching'?'open':match.status==='preparing'?'claimed':'cancelled',creatorReady,creatorReadyUntil:new Date(Date.now()+119000).toISOString()});
    const finishedGame={id:'qa-finished-game',match_id:'qa-match',launch_epoch:2,status:['live','scheduled'].includes(status)?'active':'completed',turn_started_at:new Date(Date.now()+(status==='scheduled'?4000:-30000)).toISOString(),player1_id:'p1',player2_id:'p2',pgn:'',move_log:[],fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',end_reason:'resignation',white_time_ms:300000,black_time_ms:300000};
    const wallet={id:'qa-wallet',user_id:who,balance:funded?100:0,available_balance:funded?100:0,held_balance:status==='claimed'?27:0,total_balance:funded?100:0};
    const calls=[];
    const listeners=[];
    const update=patch=>{Object.assign(match,patch);listeners.filter(listener=>listener.name==='Match').forEach(({fn})=>fn({type:'update',data:{...match}}));};
    const rows=(entity,query={})=>{
      if(entity==='Game')return ['completed','live','scheduled'].includes(status)?[{...finishedGame}]:[];
      if(entity==='Wallet')return [{...wallet}];
      if(entity==='Match')return hasChallenge && Object.entries(query).every(([key,value])=>{
        if(value && typeof value==='object'){if('$in'in value)return value.$in.includes(match[key]);if('$ne'in value)return match[key]!==value.$ne;return true;}
        return match[key]===value;
      })?[{...match}]:[];
      return [];
    };
    const entity=new Proxy({}, {get:(_,name)=>({filter:async q=>rows(name,q),get:async id=>name==='Game'?{...finishedGame}:name==='Match'?{...match}:name==='Wallet'?{...wallet}:{id},list:async()=>rows(name),subscribe:fn=>{const listener={name,fn};listeners.push(listener);return()=>{const index=listeners.indexOf(listener);if(index>=0)listeners.splice(index,1);};},update:async()=>{throw Error('Unexpected client entity write during QA');},create:async()=>{throw Error('Unexpected client entity creation during QA');}})});
    const sdk={auth:{me:async()=>{if(!user)throw Object.assign(Error('unauthorized'),{status:401});return user;},isAuthenticated:async()=>!!user,updateMe:async patch=>({...user,...patch})},entities:entity,
      analytics:{track:()=>{}},appLogs:{logUserInApp:async()=>{}},
      functions:{invoke:async(name,body={})=>{
        calls.push({name,body});
        if(name==='getGameClock')return {data:{server_now_ms:Date.now(),turn_started_at:finishedGame.turn_started_at,status:finishedGame.status,white_remaining_ms:300000,black_remaining_ms:300000,active_color:'w'}};
        if(name==='manageChallenge'){
          if(body.action==='view')return {data:{challenge:card(),role:who==='p1'?'player1':who==='p2'&&match.player2_id?'player2':'',participant:who==='p1'||(who==='p2'&&!!match.player2_id)}};
          if(body.action==='list')return {data:{challenges:hasChallenge&&who==='p1'&&match.status==='searching'?[{...card(),inviteCode:code,path:'/challenge/'+code}]:[]}};
          if(body.action==='money_location')return {data:{approved:false,status:'blocked',message:'Money play isn’t available in your current location. You can still play for free.'}};
          if(body.action==='create'){if(body.playMode!=='free'&&!funded)throw Object.assign(Error('Available funds required'),{response:{data:{action:'funds_required',error:'Your wallet needs enough available funds for the entry and fee. Pending funds do not count.'}}});hasChallenge=true;creatorReady=false;needsConsent=body.agree!==true;const tc={blitz:['Blitz (3+0)',180000],rapid:['Rapid (10+0)',600000],classical:['Classical (15+0)',900000]}[body.timeControl];update({play_mode:body.playMode,wager_amount:body.entryAmount,platform_service_fee:body.serviceFee,status:'searching',challenge_rematch_of:body.rematchOf || '',challenge_publicly_listed:body.publiclyListed,time_control:body.timeControl,display_name:tc[0],clock_initial_ms:tc[1]});return {data:{match:{...match},inviteCode:code,path:'/challenge/'+code}};}
          if(body.action==='visibility'){update({challenge_publicly_listed:body.publiclyListed});return {data:{challenge:card()}};}
          if(body.action==='readiness')return {data:free||funded?{ready:true,availableBalance:100,totalRequired:free?0:27}:{ready:false,code:'funds_required',reason:'Your wallet needs enough available funds. Pending funds do not count.',availableBalance:0,totalRequired:27}};
          if(body.action==='remember')return {data:{remembered:true,reserved:false}};
          if(body.action==='intent')return {data:{intent:null}};
          if(body.action==='consent'){needsConsent=false;return {data:{challenge:card()}};}
          if(body.action==='presence'){creatorReady=body.visible===true && (match.play_mode==='free'||funded) && !needsConsent;return {data:{available:creatorReady}};}
          if(body.action==='unready'){update({[who==='p1'?'challenge_player1_ready_at':'challenge_player2_ready_at']:''});return {data:{needsReady:true}};}
          if(body.action==='authorize'){creatorReady=true;return {data:{challenge:card(),authorizedUntil:new Date(Date.now()+120000).toISOString()}};}
          if(body.action==='accept'){if(!creatorReady)throw Object.assign(Error('Creator is not ready'),{response:{data:{code:'creator_not_ready',error:'Creator is not ready'}}});update({status:'preparing',player2_id:'p2',player1_deposited:true,player2_deposited:true,player1_certified:true,player2_certified:true});return {data:{match:{...match},accepted:true}};}
          if(body.action==='ready'){update({[who==='p1'?'challenge_player1_ready_at':'challenge_player2_ready_at']:new Date().toISOString()});return {data:{match:{...match},ready:true}};}
          if(body.action==='heartbeat')return {data:{match:{...match},ready:true}};
          if(body.action==='finalize')return {data:{match:{...match},waitingForReady:true}};
          if(body.action==='cancel'){update({status:'cancelled'});return {data:{match:{...match}}};}
          if(body.action==='ping')return {data:{notified:true}};
          if(body.action==='recover')return {data:{match:{...match}}};
        }
        if(name==='getOrCreateGame' && ['completed','live','scheduled'].includes(status))return {data:{game:{...finishedGame}}};
        if(name==='ensureWallet')return {data:{wallet:{...wallet}}};
        if(name==='getUserDisplayNames')return {data:{names:{p1:'Jordan',p2:'Opponent'}}};
        if(name==='getLaunchAvailability')return {data:{paid_contests_enabled:true,deposits_enabled:true}};
        if(name==='getAvailableMatches')return {data:{matches:hasChallenge && match.challenge_publicly_listed && who!=='p1' && match.status==='searching' ? [{...match,opponentName:'Jordan',challengePath:'/challenge/'+code,ratingStatus:'unavailable'}] : []}};
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
  },{who,funded,free,status,code,hasChallenge,creatorReady,needsConsent,publiclyListed});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:500,contentType:'application/json',body:'{"error":"Unexpected backend access in isolated browser QA"}'});
    if(url.pathname==='/src/api/base44Client.js')return route.fulfill({contentType:'text/javascript',body:'export const base44 = window.__challengeQA.sdk;'});
    if(url.pathname==='/src/lib/AuthContext.jsx')return route.fulfill({contentType:'text/javascript',body:`export const AuthProvider=({children})=>children; export const useAuth=()=>({user:window.__challengeQA.user,isAuthenticated:!!window.__challengeQA.user,isLoadingAuth:false,isLoadingPublicSettings:false,authChecked:true,authError:null,checkUserAuth:()=>{},navigateToLogin:()=>{},logout:()=>{}});`});
    return route.continue();
  });
  await page.routeWebSocket('**/*',ws=>{if(!ws.url().includes(new URL(qaOrigin).host))ws.close();else ws.connectToServer();});
  try{
    await page.goto(qaOrigin+path,{waitUntil:'networkidle',timeout:30000});
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
  for(const width of [390,1280])for(const publiclyListed of [false,true]) {
    await scenario('free-create-'+width+'-'+publiclyListed,{who:'p1',funded:false,hasChallenge:false,path:'/play',width},async page=>{
      await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Free play',exact:true}).getAttribute('aria-pressed'),'true');checks++;
      assert.equal(await page.getByRole('button',{name:'$25',exact:true}).count(),0);checks++;
      assert.equal(await page.getByRole('spinbutton').count(),0);checks++;
      const formText=(await page.getByRole('form',{name:'Create shared challenge'}).innerText()).replace('Money play','');
      assert.equal(/money|wallet|deposit|service fee|entry charge/i.test(formText),false);checks++;
      assert.equal(await page.getByRole('button',{name:'Recheck Location',exact:true}).count(),0);checks++;
      assert.equal(await page.getByText('Money play eligibility',{exact:true}).count(),0);checks++;
      const toggle=page.getByRole('switch',{name:'Show in Find an Opponent',exact:true});
      assert.equal(await toggle.getAttribute('aria-checked'),'true');checks++;
      if(!publiclyListed)await toggle.click();
      await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
      await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/play');checks++;
      await page.getByText('Free play',{exact:true}).waitFor();checks++;
      assert.equal(await page.getByRole('link',{name:'Fund Wallet',exact:true}).count(),0);checks++;
      const body=await page.evaluate(()=>window.__challengeQA.calls.find(c=>c.body.action==='create').body);
      assert.equal(body.playMode,'free');assert.equal(body.entryAmount,0);assert.equal(body.serviceFee,0);assert.equal(body.publiclyListed,publiclyListed);checks+=4;
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('button',{name:'Create Challenge',exact:true}).waitFor();checks++;
    });
  }
  for(const marketplace of [false,true])await scenario('free-accept-'+marketplace,{who:'p2',free:true,funded:false,publiclyListed:true,path:marketplace?'/play?mode=public':'/challenge/'+code},async page=>{
    await page.getByRole('button',{name:'Accept Challenge',exact:true}).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Accept Free Challenge',exact:true}).click();
    await page.waitForURL('**/play?match=qa-match');checks++;
    await page.getByRole('button',{name:'I’m Ready',exact:true}).click();
    await page.getByText('Waiting for opponent…',{exact:true}).waitFor();checks++;
    assert.equal(await page.getByText('Both entries and both service fees are reserved.',{exact:false}).count(),0);checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.name==='lockWager').length),0);checks++;
  });
  await scenario('money-mode-focused-copy',{who:'p1',funded:false,hasChallenge:false,path:'/play'},async page=>{
    await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Recheck Location',exact:true}).count(),0);checks++;
    assert.equal(await page.getByText('Money play eligibility',{exact:true}).count(),0);checks++;
    const form=page.getByRole('form',{name:'Create shared challenge'});
    assert.equal((await form.innerText()).replace('Free play','').toLowerCase().includes('free'),false);checks++;
    await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
    await page.getByRole('button',{name:'Fund Wallet',exact:true}).waitFor();checks++;
    assert.equal(await page.getByRole('button',{name:'Play for Free Instead',exact:true}).count(),0);checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='money_location').length),0);checks++;
  });
  await scenario('free-game-results',{who:'p1',free:true,funded:false,status:'completed',path:'/play?match=qa-match'},async page=>{
    await page.getByText('Free game completed.',{exact:true}).waitFor();checks++;
    await page.getByText('This game counts toward your rating.',{exact:true}).waitFor();checks++;
    assert.equal(await page.getByText(/24-hour review/).count(),0);checks++;
    assert.equal(await page.getByText('Winner Award',{exact:true}).count(),0);checks++;
    await page.getByRole('button',{name:'Run It Back',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Free play',exact:true}).getAttribute('aria-pressed'),'true');checks++;
    await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create Rematch Link',exact:true}).click();
    await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();checks++;
  });
  await scenario('anonymous-preview',{},async page=>{
    await page.getByRole('heading',{name:'Jordan’s challenge'}).waitFor();checks++;
    assert.equal(new URL(page.url()).pathname,'/challenge/'+code);checks++;
    await page.getByRole('button',{name:'Accept Challenge',exact:true}).click();
    await page.waitForURL('**/register?**');checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),0);checks++;
  });
  await scenario('pending-funds-no-claim',{who:'p2'},async page=>{
    await page.getByRole('button',{name:'Accept Challenge',exact:true}).click();
    await page.getByRole('heading',{name:'Add funds to accept'}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),0);checks++;
    await page.getByText('The challenge stays open, and another eligible player may accept first.',{exact:true}).waitFor();checks++;
    await page.getByRole('button',{name:'Add Funds in Wallet',exact:true}).waitFor();checks++;
    assert.equal(await page.getByText(/Money play requires account/).count(),0);checks++;
  });
  await scenario('unfunded-create',{who:'p1',funded:false,hasChallenge:false,path:'/play'},async page=>{
    await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Pending funds do not count'}).waitFor();checks++;
    await page.getByRole('button',{name:'Fund Wallet',exact:true}).waitFor();checks++;
    assert.equal(await page.getByRole('button',{name:'Share',exact:true}).count(),0);checks++;
  });
  await scenario('blocked-location-create',{who:'p1',funded:true,hasChallenge:false,path:'/play'},async page=>{
    await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
    await page.evaluate(()=>{const invoke=window.__challengeQA.sdk.functions.invoke;window.__challengeQA.sdk.functions.invoke=async(name,body)=>{if(body?.action==='create')throw Object.assign(Error('Blocked'),{response:{data:{action:'location_required',error:'Your current location is not approved for paid contests.'}}});return invoke(name,body);};});
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'location is not approved'}).waitFor();checks++;
    assert.equal(await page.getByRole('button',{name:'Share',exact:true}).count(),0);checks++;
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).waitFor();checks++;
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
    await scenario('create-'+value,{who:'p1',funded:true,hasChallenge:false,path:'/play',width:value==='rapid'?1280:390},async page=>{
      await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
      await page.getByText(label,{exact:true}).click();
      assert.equal(await page.getByRole('radio',{name:label+' '+minutes+' min',exact:true}).isChecked(),true);checks++;
      assert.equal(await page.getByText('The winner award includes both entry amounts; the fee is separate.',{exact:false}).count(),0);checks++;
      await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
      await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/play');
      await page.getByText(label+' ('+minutes+'+0) · No increment',{exact:true}).waitFor();checks++;
      assert.equal(await page.evaluate(()=>window.__challengeQA.calls.find(c=>c.body.action==='create').body.timeControl),value);checks++;
    });
  }
  for (const width of [390,1280]) {
    await scenario('entry-presets-'+width,{who:'p1',funded:true,hasChallenge:false,path:'/play',width},async page=>{
      await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
      const form=page.getByRole('form',{name:'Create shared challenge'});
      assert.equal(await form.getByRole('spinbutton').count(),0);checks++;
      assert.equal(await form.getByText('Custom entry amount').count(),0);checks++;
      for (const [amount,fee] of [[5,1],[10,1],[25,2],[50,4],[100,6],[250,10],[500,15],[1000,20],[2500,30]]) {
        const button=form.getByRole('button',{name:'$'+amount.toLocaleString('en-US'),exact:true});
        await button.click();
        assert.equal(await button.getAttribute('aria-pressed'),'true');checks++;
        await form.locator('dl').getByText('$'+(amount+fee).toFixed(2),{exact:true}).waitFor();checks++;
      }
      await form.getByRole('checkbox').check();
      await form.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
      await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/play');
      assert.equal(await page.evaluate(()=>window.__challengeQA.calls.find(c=>c.body.action==='create').body.entryAmount),2500);checks++;
    });
  }
  await scenario('one-open-challenge',{who:'p1',path:'/play'},async page=>{
    const create=page.getByRole('button',{name:'Create Challenge',exact:true});
    await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();
    assert.equal(await create.count(),0);checks++;
    assert.equal(await page.getByRole('button',{name:'Find an Opponent',exact:false}).getAttribute('aria-expanded'),'true');checks++;
    assert.equal(await page.getByRole('button',{name:'Create $10 Rapid Challenge',exact:true}).count(),0);checks++;
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await create.click();
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='create').length),0);checks++;
  });
  for (const funded of [false,true]) {
    await scenario('creator-direct-setup-'+funded,{who:'p1',funded,creatorReady:false},async page=>{
      await page.getByRole('heading',{name:'Your challenge is ready'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'I’m Ready for an Opponent',exact:true}).count(),0);checks++;
      await page.getByRole('button',{name:'Copy Link',exact:true}).waitFor();checks++;
      assert.equal(await page.getByRole('button',{name:'Enable Acceptance for 2 Minutes',exact:true}).count(),0);checks++;
      await page.getByRole('button',{name:'Fund Wallet',exact:true}).waitFor();checks++;
      await page.waitForFunction(()=>window.__challengeQA.calls.some(c=>c.body.action==='presence'));checks++;
      assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>['authorize','accept'].includes(c.body.action)).length),0);checks++;
    });
  }
  await scenario('create-public-toggle',{who:'p1',funded:true,hasChallenge:false,path:'/play'},async page=>{
    await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
    const toggle=page.getByRole('switch',{name:'Show in Find an Opponent',exact:true});
    assert.equal(await toggle.getAttribute('aria-checked'),'true');checks++;
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
    await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/play');
    assert.equal(await page.getByRole('link',{name:'Challenge details & visibility',exact:true}).count(),0);checks++;
    await page.getByRole('link',{name:'Fund Wallet',exact:true}).click();
    await page.getByRole('link',{name:'Return to Challenge',exact:true}).click();
    assert.equal(await toggle.getAttribute('aria-checked'),'true');checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.find(c=>c.body.action==='create').body.publiclyListed),true);checks++;
    await toggle.click();
    await page.getByText('Only people with your link can find and accept this challenge.',{exact:true}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='visibility').length),1);checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>['authorize','accept'].includes(c.body.action)).length),0);checks++;
  });
  for (const funded of [false,true]) {
    await scenario('marketplace-accept-'+funded,{who:'p2',funded,publiclyListed:true,path:'/play?mode=public'},async page=>{
      await page.getByRole('button',{name:'Accept Challenge',exact:true}).click();
      await page.waitForURL('**/play?challenge='+code+'&accept=1');checks++;
      if(funded){
        await page.getByRole('checkbox').check();
        await page.getByRole('button',{name:'Accept & Reserve $27.00',exact:true}).click();
        await page.waitForURL('**/play?match=qa-match');checks++;
        assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),1);checks++;
      }else{
        await page.getByRole('heading',{name:'Add funds to accept'}).waitFor();checks++;
        assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),0);checks++;
      }
      assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>['acceptMatch','createMatch','cancelMatch'].includes(c.name)).length),0);checks++;
    });
  }
  await scenario('anonymous-marketplace-link',{path:'/challenge/'+code+'?accept=1'},async page=>{
    await page.getByRole('button',{name:'Accept Challenge',exact:true}).click();
    await page.waitForURL('**/register?**');checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='accept').length),0);checks++;
  });
  for (const width of [390,1280]) {
    await scenario('hud-create-manage-'+width,{who:'p1',funded:true,hasChallenge:false,path:'/play',width},async page=>{
      await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
      await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
      await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/play');checks++;
      assert.equal(await page.getByRole('heading',{name:'Your challenge is ready',exact:true}).count(),0);checks++;
      assert.equal(await page.getByRole('link',{name:'Challenge details & visibility',exact:true}).count(),0);checks++;
    await page.getByRole('link',{name:'Fund Wallet',exact:true}).click();
    await page.getByRole('link',{name:'Return to Challenge',exact:true}).click();
      await page.getByText('Host or accept a challenge to begin playing',{exact:true}).waitFor({state:'attached'});checks++;
      assert.equal(await page.getByLabel('Your shareable challenge link').inputValue(),qaOrigin+'/challenge/'+code);checks++;
      await page.reload({waitUntil:'networkidle'});
      await page.getByRole('heading',{name:'Your challenge is ready'}).waitFor();checks++;
      assert.equal(new URL(page.url()).pathname,'/play');checks++;
      await page.getByRole('button',{name:'Cancel Open Challenge',exact:true}).click();
      await page.getByRole('heading',{name:'This challenge was cancelled'}).waitFor();checks++;
      assert.equal(new URL(page.url()).pathname,'/play');checks++;
      await page.getByRole('link',{name:'Create a Challenge →',exact:true}).click();
      await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
      await page.getByRole('button',{name:'Create Challenge Link',exact:true}).waitFor();checks++;
    });
  }
  await scenario('hud-rematch',{who:'p1',funded:true,status:'completed',path:'/play?match=qa-match'},async page=>{
    await page.getByRole('button',{name:'Run It Back',exact:true}).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Create Rematch Link',exact:true}).click();
    await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/play');checks++;
    assert.equal(await page.getByRole('link',{name:'Challenge details & visibility',exact:true}).count(),0);checks++;
    await page.getByRole('link',{name:'Fund Wallet',exact:true}).click();
    await page.getByRole('link',{name:'Return to Challenge',exact:true}).click();
    await page.getByText('Host or accept a challenge to begin playing',{exact:true}).waitFor({state:'attached'});checks++;
    assert.equal(await page.getByRole('switch',{name:'Show in Find an Opponent',exact:true}).isEnabled(),false);checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.find(c=>c.body.action==='create').body.rematchOf),'qa-match');checks++;
  });
  for (const publiclyListed of [false,true]) {
    await scenario('pending-hud-'+publiclyListed,{who:'p1',path:'/play',publiclyListed},async page=>{
      await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();checks++;
      assert.equal(await page.getByRole('heading',{name:'Challenge Someone',exact:true}).count(),0);checks++;
      assert.equal(await page.getByRole('button',{name:'Create Challenge',exact:true}).count(),0);checks++;
      await page.getByText(publiclyListed?'Public challenge':'Link-only challenge',{exact:true}).waitFor();checks++;
      assert.equal(await page.getByRole('button',{name:'Find an Opponent',exact:false}).getAttribute('aria-expanded'),'true');checks++;
      await page.getByRole('button',{name:'Refresh Available Matches',exact:true}).waitFor();checks++;
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('button',{name:'Create Challenge',exact:true}).waitFor();checks++;
    });
  }
  await scenario('create-link-only-opt-out',{who:'p1',funded:true,hasChallenge:false,path:'/play'},async page=>{
    await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
    const toggle=page.getByRole('switch',{name:'Show in Find an Opponent',exact:true});
    assert.equal(await toggle.getAttribute('aria-checked'),'true');checks++;
    await toggle.click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Create Challenge Link',exact:true}).click();
    await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();checks++;
    await page.getByText('Link-only challenge',{exact:true}).waitFor();checks++;
    assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/play');checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.find(c=>c.body.action==='create').body.publiclyListed),false);checks++;
  });
  await scenario('pending-hud-fund-wallet',{who:'p1',creatorReady:false,path:'/play'},async page=>{
    await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();checks++;
    assert.equal(await page.getByRole('link',{name:'Review eligibility & enable acceptance',exact:true}).count(),0);checks++;
    await page.getByText('To play this match, you need $27.00 in available wallet funds, including the service fee. Pending deposits cannot be used yet.',{exact:true}).waitFor();checks++;
    await page.getByRole('link',{name:'Fund Wallet',exact:true}).click();
    await page.waitForURL('**/wallet?challenge='+code);checks++;
    await page.getByRole('heading',{name:'Fund your wallet, keep your options open',exact:true}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('chessbet_challenge_context:p1')).inviteCode),code);checks++;
    await page.getByRole('link',{name:'Return to Challenge',exact:true}).click();
    await page.waitForURL('**/play?challenge='+code);checks++;
    await page.getByRole('button',{name:'Fund Wallet',exact:true}).waitFor();checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>['accept','authorize'].includes(c.body.action)).length),0);checks++;
  });
  await scenario('pending-summary-desktop',{who:'p1',publiclyListed:true,path:'/play',width:1280},async page=>{
    await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();checks++;
    await page.getByRole('button',{name:'Refresh Available Matches',exact:true}).waitFor();checks++;
    await page.getByRole('button',{name:'Share',exact:true}).waitFor();checks++;
    await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();checks++;
    assert.equal(await page.getByRole('button',{name:'Find an Opponent',exact:false}).getAttribute('aria-expanded'),'true');checks++;
  });
  await scenario('legacy-consent-in-hud',{who:'p1',funded:true,needsConsent:true,creatorReady:false,path:'/play'},async page=>{
    const confirm=page.getByRole('button',{name:'Confirm Challenge Terms',exact:true});
    await confirm.waitFor();assert.equal(await confirm.isEnabled(),false);checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='presence').length),0);checks++;
    await page.getByRole('checkbox').check();await confirm.click();
    await page.waitForFunction(()=>window.__challengeQA.calls.some(c=>c.body.action==='presence'&&c.body.visible));checks++;
    assert.equal(await page.getByRole('button',{name:'Enable Acceptance for 2 Minutes',exact:true}).count(),0);checks++;
  });
  await scenario('new-create-consent-and-presence',{who:'p1',funded:true,hasChallenge:false,creatorReady:false,path:'/play'},async page=>{
    await page.getByRole('button',{name:'Create Challenge',exact:true}).click();
    await page.getByRole('button',{name:'Money play',exact:true}).click();
    const create=page.getByRole('button',{name:'Create Challenge Link',exact:true});
    assert.equal(await create.isEnabled(),false);checks++;
    await page.getByRole('checkbox').check();await create.click();
    await page.getByRole('heading',{name:'Your next match starts here',exact:true}).waitFor();
    await page.waitForFunction(()=>window.__challengeQA.calls.some(c=>c.body.action==='presence'&&c.body.visible));checks++;
    const body=await page.evaluate(()=>window.__challengeQA.calls.find(c=>c.body.action==='create').body);
    assert.equal(body.agree,true);assert.equal(body.consentVersion,'challenge-visible-hud-v2');checks+=2;
    assert.equal(await page.getByRole('button',{name:'Confirm Challenge Terms',exact:true}).count(),0);checks++;
  });
  await scenario('leaving-withdraws-readiness',{who:'p1',funded:true,status:'claimed',path:'/play?match=qa-match'},async page=>{
    await page.getByRole('button',{name:'I’m Ready',exact:true}).click();
    await page.getByText('Waiting for opponent…',{exact:true}).waitFor();
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>window.__challengeQA.calls.some(c=>c.body.action==='unready'));checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.match.challenge_player1_ready_at),'');checks++;
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.getByRole('button',{name:'I’m Ready',exact:true}).waitFor();checks++;
  });
  await scenario('active-game-refresh-no-countdown',{who:'p1',funded:true,status:'live',path:'/play?match=qa-match'},async page=>{
    await page.waitForFunction(()=>window.__challengeQA.calls.some(c=>c.name==='getGameClock'));checks++;
    await page.getByText('Both Players Ready',{exact:true}).waitFor({state:'hidden'});checks++;
    await page.reload({waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__challengeQA.calls.some(c=>c.name==='getGameClock'));checks++;
    assert.equal(await page.getByText('Both Players Ready',{exact:true}).count(),0);checks++;
  });
  await scenario('scheduled-countdown-uses-server',{who:'p1',funded:true,status:'scheduled',path:'/play?match=qa-match'},async page=>{
    await page.getByText('Both Players Ready',{exact:true}).waitFor();checks++;
    await page.getByText('Both Players Ready',{exact:true}).waitFor({state:'hidden',timeout:6000});checks++;
    assert.ok(await page.evaluate(()=>window.__challengeQA.calls.some(c=>c.name==='getGameClock')));checks++;
  });
  await scenario('hide-during-ready-request',{who:'p1',funded:true,status:'claimed',path:'/play?match=qa-match'},async page=>{
    await page.getByRole('button',{name:'I’m Ready',exact:true}).waitFor();
    await page.evaluate(()=>{const invoke=window.__challengeQA.sdk.functions.invoke;window.__challengeQA.sdk.functions.invoke=async(name,body)=>{if(body?.action==='ready')await new Promise(resolve=>window.__finishReady=resolve);return invoke(name,body);};});
    await page.getByRole('button',{name:'I’m Ready',exact:true}).click();
    await page.waitForFunction(()=>Boolean(window.__finishReady));
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.__finishReady();});
    await page.waitForFunction(()=>window.__challengeQA.calls.filter(c=>c.body.action==='unready').length>=2);checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.match.challenge_player1_ready_at),'');checks++;
    assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>c.body.action==='finalize').length),0);checks++;
  });
}finally{await browser.close();}
console.log(JSON.stringify({checks,scenarios,failed:failures,screenshots:'/tmp/chessbet-challenge-screenshots'},null,2));
process.exitCode=failures.length?1:0;
