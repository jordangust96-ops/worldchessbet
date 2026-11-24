import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
const qaRequire=createRequire('/tmp/chessbet-browser-check/package.json');
const { chromium }=qaRequire('playwright');
const serverChromium=qaRequire('@sparticuz/chromium').default;
const { build }=createRequire(resolve('package.json'))('esbuild');
const fixture=`
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import GameHUD from '@/components/play/matchview/GameHUD';
import PlayLayout from '@/components/play/PlayLayout';
import ChessboardPreview from '@/components/play/ChessboardPreview';
const start=Date.parse('2026-11-24T12:00:00Z');
const origin=performance.now();
let serverOffset=0;
const serverNow=()=>start+performance.now()-origin+serverOffset;
const match={id:'m',player1_id:'white',player2_id:'black',play_mode:'free',wager_amount:0,display_name:'Rapid (10+0)',clock_initial_ms:600000};
let game={id:'g',match_id:'m',launch_epoch:2,status:'active',fen:'r3k1nr/pp3pp1/2pb1q1p/3p4/3Nn3/1QP1BB1P/PP3PP1/R4RK1 b kq - 2 15',
  pgn:'',white_time_ms:385387,black_time_ms:371220,turn_started_at:new Date(start).toISOString(),
  black_last_seen_at:new Date(start-30000).toISOString(),black_disconnected_at:'',
  black_disconnect_policy_version:'chessbet-reconnect-v3'};
let renderGame;
window.qa={calls:[],change(mode){
  game={...game,black_disconnected_at:mode==='connected'?'':new Date(start).toISOString()};
  if(mode==='offturn')game.fen=game.fen.replace(' b ',' w ');
  else game.fen=game.fen.replace(' w ',' b ');
  if(mode==='offturn')serverOffset=0;
  if(mode==='expired')serverOffset=68001;
  renderGame(game);
  window.dispatchEvent(new Event('focus'));
}};
window.mockSdk={auth:{me:async()=>({id:'white',role:'user'})},entities:new Proxy({}, {get:()=>({filter:async()=>[]})}),
 functions:{invoke:async(name)=>{
  window.qa.calls.push(name);
  if(name==='getUserDisplayNames')return {data:{names:{white:'king_j',black:'Michael'},foundingPlayers:{}}};
  if(name==='getGameClock')return {data:{game_id:'g',game,fen:game.fen,status:game.status,
    server_now_ms:serverNow(),active_color:game.fen.split(' ')[1],turn_started_at:game.turn_started_at,
    white_remaining_ms:game.white_time_ms,black_remaining_ms:game.black_time_ms,
    disconnect:{white:null,black:game.black_disconnected_at?{disconnectedAt:game.black_disconnected_at,
      deadlineMs:start+68000}:null}}};
  if(name==='gameHeartbeat')return {data:{game}};
  return {data:{}};
 }}};
function App(){
 const [current,setGame]=useState(game);renderGame=setGame;
 return <div className="lg:flex lg:h-[calc(100dvh-var(--app-safe-top))] lg:flex-col">
   <header className="min-h-[88px] shrink-0" />
   <main className="app-page-with-nav play-page-with-nav lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
     <PlayLayout showMobileBoard board={<ChessboardPreview state="in_progress" fen={current.fen} />}>
       <div className="game-match-panel px-3 lg:h-full lg:overflow-y-auto">
         <GameHUD game={current} match={match} userId="white" onGameSync={()=>false}
           movementMode="click" touchOnlyInput soundEnabled={false} />
       </div>
     </PlayLayout>
   </main>
   <nav className="app-bottom-nav fixed bottom-0 left-0 right-0" style={{height:74}} />
 </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
const result=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
 plugins:[{name:'isolated-transport',setup(b){
  b.onResolve({filter:/^@\/(api\/base44Client|components\/ui\/use-toast)$/},({path})=>({path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path.includes('base44Client')?'export const base44 = new Proxy({}, {get:(_,key)=>window.mockSdk[key]});':'const toast=()=>{};export const useToast=()=>({toast});'}));
  b.onResolve({filter:/^@\//},({path})=>b.resolve(resolve('src',path.slice(2)),{kind:'import-statement',resolveDir:process.cwd()}));
 }}]});
const cssFiles=(await readdir('dist/assets')).filter(name=>name.endsWith('.css'));
const css=(await Promise.all(cssFiles.map(name=>readFile('dist/assets/'+name,'utf8')))).join('\n');
// The sandbox browser uses fonts and shared libraries outside app dependencies.
const browser=await chromium.launch({
  args:serverChromium.args,
  executablePath:await serverChromium.executablePath(),
  env:{...process.env,FONTCONFIG_PATH:'/tmp/fonts',FONTCONFIG_FILE:'/tmp/fonts/fonts.conf',LD_LIBRARY_PATH:'/tmp/chessbet-browser-check/lib'},
});
try {
  const context=await browser.newContext({reducedMotion:'reduce'});
  for (const [width,height] of [[320,568],[390,844],[568,320],[1024,600],[1280,480]]) {
    const page=await context.newPage();
    await page.setViewportSize({width,height});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.abort());
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:result.outputFiles[0].text});
    const board=page.locator('[data-boardid]');
    const slot=page.getByTestId(width<1024?'opponent-connection-mobile':'opponent-connection-desktop');
    await board.waitFor();
    const connectedBoard=await board.boundingBox();
    assert.equal(await page.locator('[data-testid^="opponent-connection-"]:visible').count(),0);
    await page.evaluate(()=>window.qa.change('disconnected'));
    await slot.getByText('Opponent disconnected',{exact:true}).waitFor({timeout:8000});
    await slot.getByText(/Forfeits in 1:0/).waitFor();
    assert.equal(await page.locator('[data-testid^="opponent-connection-"]:visible').count(),1);
    const notice=await slot.boundingBox();
    const playing=await board.boundingBox();
    const nav=await page.locator('nav').boundingBox();
    assert.ok(notice.y>=0&&notice.y+notice.height<=nav.y);
    assert.ok(playing.y+playing.height<=notice.y||playing.x+playing.width<=notice.x||notice.x+notice.width<=playing.x);
    if(width>=1024) {
      const panel=await page.locator('.game-match-panel').boundingBox();
      assert.ok(notice.y>=panel.y&&notice.y-panel.y<55);
      await page.locator('.game-match-panel').evaluate(el=>{el.scrollTop=1000;});
      const scrolled=await slot.boundingBox();
      assert.ok(Math.abs(scrolled.y-panel.y)<12);
    } else {
      await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
      assert.equal((await slot.boundingBox()).y,notice.y);
    }
    const firstCountdown=await slot.getByText(/Forfeits in/).innerText();
    await page.waitForFunction(before=>[...document.querySelectorAll('p')].some(p=>p.textContent.startsWith('Forfeits in')&&p.textContent!==before),firstCountdown);
    await page.evaluate(()=>window.qa.change('connected'));
    await slot.waitFor({state:'detached'});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForFunction(width=>Math.abs(document.querySelector('[data-boardid]').getBoundingClientRect().width-width)<1,connectedBoard.width);
    await page.evaluate(()=>window.qa.change('offturn'));
    await slot.getByText(/Forfeits in 1:0/).waitFor();
    await page.getByText('Your Move',{exact:true}).waitFor();
    await page.evaluate(()=>window.qa.change('expired'));
    await slot.getByText('Confirming result…',{exact:true}).waitFor();
    await page.waitForFunction(()=>window.qa.calls.includes('gameHeartbeat'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    await page.close();
    console.log('PASS '+width+' × '+height+': visible pinned notice, unobstructed board, countdown, reconnect, and confirmation.');
  }
} finally {await browser.close();}
