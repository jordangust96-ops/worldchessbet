import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const pause = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const source = (await readFile('src/hooks/useChessClock.js','utf8')).replace(/^import[^\n]+\n/gm,'').replace('export function useChessClock','function useChessClock');
let slots=[],cursor=0,effects=[],output,dirty=true,now=10000,intervals=new Map(),timer=0,requests=[],events={},applied=[];
let game={id:'g',status:'active',fen:'position w - - 0 1',turn_started_at:'2026-11-12T20:00:00Z',white_time_ms:180000,black_time_ms:180000};
const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
function useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return [slots[i],n=>{slots[i]=n;dirty=true;}];}
function useRef(v){const i=cursor++;if(!(i in slots))slots[i]={current:v};return slots[i];}
function useCallback(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;}
function useEffect(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
const surface={visibilityState:'visible',addEventListener(n,fn){(events[n]??=new Set()).add(fn);},removeEventListener(n,fn){events[n]?.delete(fn);}};
const sdk={functions:{invoke(name,body){const d=deferred();requests.push({name,body,...d});return d.promise;}}};
const onSync=latest=>{applied.push(latest);if(latest.id===game.id && latest.turn_started_at>=game.turn_started_at){game=latest;dirty=true;}};
const hook=new Function('useState','useEffect','useRef','useCallback','base44','performance','document','window','setInterval','clearInterval',source+'\nreturn useChessClock;')(useState,useEffect,useRef,useCallback,sdk,{now:()=>now},surface,surface,(fn,ms)=>{intervals.set(++timer,{fn,ms});return timer;},id=>intervals.delete(id));
function render(){cursor=0;dirty=false;output=hook(game,onSync);const run=effects;effects=[];run.forEach(f=>f());}
async function flush(){for(let i=0;i<8;i++){if(dirty)render();await pause();}}
async function tick(ms=100){now+=ms;for(const t of intervals.values())if(t.ms===100)t.fn();await flush();}
const pending=name=>requests.filter(r=>r.name===name&&!r.done);
function reply(r,data){r.done=true;r.resolve({data});}
function snapshot(g,remaining=170000){return {game_id:g.id,game:g,fen:g.fen,status:g.status,active_color:g.fen.split(' ')[1],turn_started_at:g.turn_started_at,server_now_ms:Date.parse('2026-11-12T20:00:10Z'),white_remaining_ms:remaining,black_remaining_ms:180000};}
await flush();
assert.equal(pending('getGameClock').length,1);
for(const fn of events.focus)fn();for(const fn of events.online)fn();
assert.equal(pending('getGameClock').length,1,'focus/online bursts are coalesced');
const first=game;reply(pending('getGameClock')[0],snapshot(first));await flush();
await tick(1000);assert.equal(output.w,169000);assert.equal(output.b,180000);
// Clock learns an opponent turn before the realtime board event.
for(const fn of events.focus)fn();
const second={...game,fen:'position b - - 0 1',turn_started_at:'2026-11-12T20:00:11Z',white_time_ms:169000};
reply(pending('getGameClock')[0],snapshot(second,169000));await flush();
assert.equal(game,second,'clock recovery advances the shared board');
assert.equal(output.w,169000);
await tick(500);assert.equal(output.w,169000,'white stops as soon as board changes');
assert.ok(output.b<180000,'black runs for the same board turn');
reply(pending('getGameClock')[0],{...snapshot(second,169000),server_now_ms:Date.parse('2026-11-12T20:00:11Z'),black_remaining_ms:179500});await flush();
// A stale pre-move response cannot switch the clock back.
for(const fn of events.focus)fn();
reply(pending('getGameClock')[0],snapshot(first));await flush();await tick(500);
assert.equal(game,second);assert.equal(output.w,169000);
assert.ok(output.b<179500);
// Completion cancels an in-flight response.
for(const fn of events.focus)fn();const late=pending('getGameClock')[0];
game={...second,status:'completed',black_time_ms:0};dirty=true;await flush();
reply(late,snapshot(second));await flush();await tick(500);
assert.deepEqual(output,{w:169000,b:0},'late response cannot revive a completed clock');
// Fresh game + slow response must not subtract seconds of server processing.
game={...first,id:'g2'};dirty=true;await flush();now+=8000;
reply(pending('getGameClock')[0],{...snapshot(game,1000),game_id:'g2'});await flush();
assert.equal(output.w,750,'latency correction is bounded to 250ms');
await tick(800);assert.equal(pending('checkTimeout').length,1);
const timeout=pending('checkTimeout')[0];timeout.done=true;timeout.reject(new Error('offline'));await flush();
for(let i=0;i<20;i++)await tick(100);
assert.equal(requests.filter(r=>r.name==='checkTimeout').length,1,'failed timeouts do not flood the server');
await tick(1100);assert.equal(pending('checkTimeout').length,1);
reply(pending('checkTimeout')[0],{game:{...game,status:'completed',white_time_ms:0}});
await flush();assert.equal(game.status,'completed');
for(const slot of slots)slot?.cleanup?.();
// Exercise the actual clock endpoint's authorization and paired response.
const endpointSource = (await readFile('base44/functions/getGameClock/entry.ts','utf8')).replace(/^import[^\n]+\n/gm,'');
const clockGame = {...first,launch_epoch:2,match_id:'m',turn_started_at:new Date(Date.now()-10000).toISOString()};
let caller={id:'outsider'}, endpoint;
const client={auth:{me:async()=>caller},asServiceRole:{entities:{
  Game:{get:async()=>clockGame},Match:{get:async()=>({player1_id:'white',player2_id:'black'})}
}}};
new Function('Deno','createClientFromRequest',endpointSource)({serve:fn=>{endpoint=fn;}},()=>client);
const req=()=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify({gameId:'g'})});
assert.equal((await endpoint(req())).status,403,'outsiders cannot read the game through clock sync');
caller=null;assert.equal((await endpoint(req())).status,401);
caller={id:'white'};
const response=await endpoint(req());assert.equal(response.status,200);
const data=await response.json();
assert.equal(data.game.fen,clockGame.fen);assert.equal(data.fen,data.game.fen);
assert.equal(data.turn_started_at,data.game.turn_started_at);
assert.ok(data.white_remaining_ms<=170000 && data.white_remaining_ms>165000);
assert.equal(data.black_remaining_ms,180000);
console.log('Clock/board ordering, stale responses, reconnect bursts, turn changes, completion, slow network, timeout backoff and server authorization passed.');
