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
    const card=()=>({playMode:match.play_mode,creatorConsentRequired:needsConsent,isRematch:Boolean(match.challenge_rematch_of),publiclyListed:match.challenge_publicly_listed,id:match.id,creatorName:'ChessBet player',entryAmount:match.wager_amount,serviceFee:match.platform_service_fee,totalRequired:match.wager_amount+match.platform_service_fee,winnerAward:match.wager_amount*2,displayName:match.display_name,expiresAt:match.challenge_expires_at,status:status==='processing'?'processing':match.status==='searching'?'open':match.status==='preparing'?'claimed':'cancelled',creatorReady,creatorReadyUntil:new Date(Date.now()+119000).toISOString()});
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
try {
 for(const width of [390,1280]) for(const status of ['open','processing','closed']) {
  await scenario('invitation-'+status+'-'+width,{who:'p2',funded:true,status,width},async page=>{
   await page.getByRole('heading',{name:'Chess challenge',exact:true}).waitFor();
   assert.equal(await page.getByText('Your total',{exact:true}).count(),1);
   assert.equal(await page.getByText('$25.00 entry + $2.00 fee',{exact:true}).count(),1);
   assert.equal(await page.getByText('Your Entry Amount',{exact:true}).count(),0);
   assert.equal(await page.locator('details').getAttribute('open'),null);
   assert.equal(await page.getByText(/The creator’s challenge is still/).count(),0);
   assert.equal(await page.evaluate(()=>window.__challengeQA.calls.filter(c=>['accept','recover','create'].includes(c.body.action)).length),0);
   if(status==='open'){
    const button=page.getByRole('button',{name:'Accept Challenge',exact:true});
    await button.waitFor();
    assert.ok((await button.boundingBox()).y<650,'Action is visible without scrolling on mobile');
    await button.click();
    const accept=page.getByRole('button',{name:'Accept & Reserve $27.00',exact:true});
    assert.equal(await accept.isDisabled(),true);
    await page.getByRole('checkbox').check();
    assert.equal(await accept.isEnabled(),true);
   } else {
    assert.equal(await page.getByRole('button',{name:'Accept Challenge',exact:true}).count(),0);
    if(status==='processing')await page.getByText('This challenge is temporarily unavailable. Please check again shortly.').waitFor();
    else await page.getByRole('heading',{name:'This challenge was cancelled'}).waitFor();
   }
   await page.locator('summary').click();
   assert.equal(await page.getByText(/The winner receives both entry amounts/).isVisible(),true);
   await page.locator('summary').click();
   checks+=9;
  });
 }
} finally { await browser.close(); }
console.log(JSON.stringify({checks,scenarios,failed:failures}));
process.exitCode=failures.length?1:0;
