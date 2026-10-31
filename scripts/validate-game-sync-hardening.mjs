import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { Chess } from 'chess.js';
import { webcrypto } from 'node:crypto';

const pause = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const stripImports = text => text.replace(/^import[\s\S]*?;\s*/gm, '');

// Execute the production guard and handlers with isolated storage and leases.
const guardSource = (await transform(stripImports(await readFile('base44/shared/gameMutationGuard.ts','utf8')), {loader:'ts',format:'esm'})).code.replace('export {\n  guardGameMutations\n};','');
const locks = new Map();
const guardGameMutations = new Function('acquireMatchLock','releaseMatchLock','refreshContestLocks','crypto', guardSource+'\nreturn guardGameMutations;')(
  async (key,owner) => { if(locks.has(key))return false;locks.set(key,owner);return true; },
  async (key,owner) => { if(locks.get(key)===owner)locks.delete(key); },
  async (key,ids,owner) => locks.get(key)===owner, webcrypto);
const initial = () => ({id:'g',match_id:'m',launch_epoch:2,status:'active',result:'unfinished',fen:new Chess().fen(),move_log:[],pgn:'',white_time_ms:900000,black_time_ms:900000,turn_started_at:new Date().toISOString()});
let record=initial(), writes=0;
const entity = {get:async()=>structuredClone(record),filter:async()=>[structuredClone(record)],update:async(id,patch)=>{await pause();writes++;record={...record,...structuredClone(patch)};return structuredClone(record);}};
const match={id:'m',player1_id:'w',player2_id:'b'};
function client(userId='w'){return {auth:{me:async()=>({id:userId})},asServiceRole:{entities:{Game:entity,Match:{get:async()=>match}}}};}
async function handler(name,userId='w'){
 let text=stripImports(await readFile('base44/functions/'+name+'/entry.ts','utf8'));
 text=(await transform(text,{loader:'ts',format:'esm'})).code;
 let fn; new Function('Deno','createClientFromRequest','Chess','guardGameMutations',text)({serve:f=>{fn=f;}},()=>client(userId),Chess,guardGameMutations); return fn;
}
const request = body => new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)});
const move=await handler('submitMove');
let r=await move(request({gameId:'g',from:'e2',to:'e4',expectedFen:record.fen}));
assert.equal(r.status,200);assert.equal(record.move_log.length,1);
const saved=structuredClone(record);
r=await move(request({gameId:'g',from:'e2',to:'e4',expectedFen:initial().fen}));
assert.equal(r.status,409);assert.deepEqual(record,saved);

// Both requests pass their pre-commit reads before either write completes.
record=initial();writes=0;
const results=await Promise.all(['e4','d4'].map(to=>move(request({gameId:'g',from:to==='e4'?'e2':'d2',to,expectedFen:record.fen}))));
assert.equal(writes,1);assert.equal(record.move_log.length,1);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
record=initial();writes=0;
const resign=await handler('resignGame');
await Promise.all([move(request({gameId:'g',from:'e2',to:'e4',expectedFen:record.fen})),resign(request({gameId:'g'}))]);
assert.equal(writes,1);

// A stale sweep must not overwrite a move committed after its snapshot.
record=initial();const sweep=guardGameMutations(client());await sweep.asServiceRole.entities.Game.filter({});
const before=record.fen;await move(request({gameId:'g',from:'e2',to:'e4',expectedFen:before}));
await assert.rejects(sweep.asServiceRole.entities.Game.update('g',{status:'completed',result:'black_win'}),/state changed/);
assert.equal(record.status,'active');

// Real hook, executed with a deterministic hook scheduler and mocked network.
const source=stripImports(await readFile('src/hooks/useChessGame.js','utf8')).replace('export function useChessGame','function useChessGame');
let slots=[],cursor=0,effects=[],output,dirty=false,subscriptions=[],intervals=new Map(),timerId=0,submit,latest=initial(),notices=[];
const depsEqual=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
function useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],v=>{const next=typeof v==='function'?v(slots[i]):v;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];}
function useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];}
function useCallback(fn,deps){const i=cursor++;if(!slots[i]||!depsEqual(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;}
function useEffect(fn,deps){const i=cursor++;if(!slots[i]||!depsEqual(slots[i].deps,deps)){const previous=slots[i];slots[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}}
const sdk={entities:{Match:{get:async()=>match},Game:{get:async()=>structuredClone(latest),subscribe:cb=>{subscriptions.push(cb);return()=>{subscriptions=subscriptions.filter(x=>x!==cb);};}}},analytics:{track:async()=>{}},functions:{invoke:async(name)=>name==='getOrCreateGame'?{data:{game:structuredClone(latest)}}:name==='submitMove'?submit.promise:{data:{}}}};
const events={addEventListener(){},removeEventListener(){},setTimeout,clearTimeout};
const hook=new Function('useState','useEffect','useCallback','useRef','Chess','base44','useToast','window','document','setInterval','clearInterval',source+'\nreturn useChessGame;')(useState,useEffect,useCallback,useRef,Chess,sdk,()=>({toast:x=>notices.push(x)}),events,{...events,visibilityState:'visible',hidden:false},(fn,ms)=>{const id=++timerId;intervals.set(id,{fn,ms});return id;},id=>intervals.delete(id));
function render(){cursor=0;dirty=false;output=hook('m','w',true);const pending=effects;effects=[];pending.forEach(fn=>fn());}
async function flush(){for(let i=0;i<12;i++){if(dirty||!output)render();await pause();}}
function emit(game){latest=game;subscriptions.forEach(cb=>cb({type:'update',data:structuredClone(game)}));}
await flush();
const base=output.fen;
submit=deferred();assert.equal(output.handleDrop('e2','e4'),true);await flush();
assert.equal(output.fen,base,'unconfirmed move cannot change the board');
assert.match(output.syncMessage,/Confirming/);
assert.equal(output.handleDrop('d2','d4'),false,'no second in-flight move');
const chess=new Chess();chess.move('e4');const first={...initial(),fen:chess.fen(),updated_date:'2026-10-31T22:00:01Z'};
submit.resolve({data:{game:first}});await flush();
assert.equal(output.fen,first.fen,'HTTP response confirms even without realtime');
assert.equal(output.syncMessage,'');
chess.move('e5');const second={...first,fen:chess.fen(),updated_date:'2026-10-31T22:00:02Z'};emit(second);await flush();
emit(first);await flush();assert.equal(output.fen,second.fen,'late realtime cannot undo a move');
// A lost response after a committed move resolves from a fresh authoritative read.
submit=deferred();output.handleDrop('g1','f3');await flush();chess.move('Nf3');
latest={...second,fen:chess.fen(),updated_date:'2026-10-31T22:00:03Z'};
submit.reject(new Error('network lost'));await flush();assert.equal(output.fen,latest.fen);assert.equal(output.syncMessage,'');
// A rejected move keeps the confirmed board and becomes actionable again.
emit({...latest,fen:(()=>{chess.move('Nc6');return chess.fen();})(),updated_date:'2026-10-31T22:00:04Z'});await flush();
const confirmed=output.fen;submit=deferred();output.handleDrop('f1','b5');await flush();submit.reject(new Error('not saved'));await flush();assert.equal(output.fen,confirmed);assert.equal(output.syncMessage,'');assert.ok(notices.length);
// Castling is displayed only after acknowledgement, survives refresh, and
// cannot be undone by a delayed pre-castle snapshot.
const castle = new Chess();
for (const san of ['e4','e5','Nf3','Nc6','Bc4','Nf6']) castle.move(san);
const preCastle={...initial(),fen:castle.fen(),updated_date:'2026-10-31T22:00:05Z'};
emit(preCastle);await flush();submit=deferred();
assert.equal(output.handleDrop('e1','g1'),true);await flush();
assert.equal(output.fen,preCastle.fen);
castle.move('O-O');
const castled={...preCastle,fen:castle.fen(),updated_date:'2026-10-31T22:00:06Z'};
latest=castled;submit.resolve({data:{game:castled}});await flush();
assert.equal(output.fen,castled.fen);
emit(preCastle);await flush();assert.equal(output.fen,castled.fen);
latest=castled;
for(const slot of slots)slot?.cleanup?.();
slots=[];cursor=0;effects=[];output=undefined;dirty=true;
await flush();assert.equal(output.fen,castled.fen,'refresh restores the confirmed castle');
for(const slot of slots)slot?.cleanup?.();
console.log('Actual handler races, stale sweep, duplicate requests, response confirmation, pending input, stale updates, lost responses and rejected-move recovery passed.');
