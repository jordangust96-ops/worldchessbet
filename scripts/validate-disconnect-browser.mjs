import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const qaRequire=createRequire('/tmp/chessbet-browser-check/package.json');
const { chromium }=qaRequire('playwright');
const serverChromium=qaRequire('@sparticuz/chromium').default;
const { build }=createRequire(resolve('package.json'))('esbuild');
const fixture=`
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import GameHUD from '@/components/play/matchview/GameHUD';
const start=Date.parse('2026-11-24T12:00:00Z');
const origin=performance.now();
let serverOffset=0;
const serverNow=()=>start+performance.now()-origin+serverOffset;
const match={id:'m',player1_id:'white',player2_id:'black',play_mode:'free',wager_amount:0,display_name:'Rapid (10+0)',clock_initial_ms:600000};
let game={id:'g',match_id:'m',launch_epoch:2,status:'active',fen:'r3k1nr/pp3pp1/2pb1q1p/3p4/3Nn3/1QP1BB1P/PP3PP1/R4RK1 b kq - 2 15',
  pgn:'',white_time_ms:385387,black_time_ms:371220,turn_started_at:new Date(start).toISOString(),
  black_last_seen_at:new Date(start-30000).toISOString(),black_disconnected_at:'',
  black_disconnect_policy_version:'chessbet-reconnect-v2'};
let renderGame;
window.qa={calls:[],change(mode){
  game={...game,black_disconnected_at:mode==='connected'?'':new Date(start).toISOString()};
  if(mode==='notturn')game.fen=game.fen.replace(' b ',' w ');
  else game.fen=game.fen.replace(' w ',' b ');
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
      deadlineMs:game.fen.split(' ')[1]==='b'?start+68000:null}:null}}};
  if(name==='gameHeartbeat')return {data:{game}};
  return {data:{}};
 }}};
function App(){
 const [current,setGame]=useState(game);renderGame=setGame;
 return <div style={{maxWidth:400,padding:20,background:'#151515',color:'white'}}>
 <GameHUD game={current} match={match} userId="white" onGameSync={()=>false}
 movementMode="click" touchOnlyInput soundEnabled={false} />
 <div data-testid="board-marker" style={{height:80,marginTop:12,border:'1px solid #C9A84C'}}>Layout reference</div>
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
const browser=await chromium.launch({args:serverChromium.args,executablePath:await serverChromium.executablePath()});
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:result.outputFiles[0].text});
  await page.waitForSelector('[data-testid="opponent-connection-slot"]');
  const slot=page.getByTestId('opponent-connection-slot');
  const initial=await slot.boundingBox();
  assert.equal(await page.getByText('Opponent disconnected',{exact:true}).count(),0);
  await page.evaluate(()=>window.qa.change('disconnected'));
  await page.getByText('Opponent disconnected',{exact:true}).waitFor({timeout:8000}).catch(async error=>{console.log(JSON.stringify({errors,text:await page.locator('body').innerText(),qa:await page.evaluate(()=>({calls:window.qa.calls,html:document.body.outerHTML.slice(0,500),ancestors:[...document.querySelectorAll('body, #root, #root > div, [data-testid="opponent-connection-slot"], [data-testid="opponent-connection-slot"] *')].map(e=>({tag:e.tagName,display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,height:e.getBoundingClientRect().height}))}))}));throw error;});
  await page.getByText(/Forfeits in 1:0/).waitFor();
  assert.equal(await page.getByText('Opponent disconnected',{exact:true}).count(),1,'one notice');
  const disconnected=await slot.boundingBox();
  assert.equal(disconnected.height,initial.height);assert.equal(disconnected.y,initial.y);
  const firstCountdown=await page.getByText(/Forfeits in/).innerText();
  await page.waitForFunction(before=>[...document.querySelectorAll('p')].some(p=>p.textContent.startsWith('Forfeits in')&&p.textContent!==before),firstCountdown);
  await page.screenshot({path:'/tmp/chessbet-disconnect-'+width+'.png',fullPage:true});
  await page.evaluate(()=>window.qa.change('connected'));
  await page.getByText('Opponent disconnected',{exact:true}).waitFor({state:'hidden'});
  assert.equal((await slot.boundingBox()).y,initial.y);
  await page.evaluate(()=>window.qa.change('notturn'));
  await page.getByText('Countdown starts on their turn',{exact:true}).waitFor();
  await page.evaluate(()=>window.qa.change('expired'));
  await page.getByText('Confirming result…',{exact:true}).waitFor();
  assert.equal(await page.getByText('Opponent disconnected',{exact:true}).count(),1);
  assert.ok((await page.evaluate(()=>window.qa.calls)).includes('gameHeartbeat'),'deadline asks server to verify');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS '+width+'px: one notice, ticking server countdown, fixed layout, reconnect removal, waiting turn and final confirmation');
 }
}finally{await browser.close();}
