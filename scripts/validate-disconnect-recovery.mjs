import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { checkDisconnectTimeout, getDisconnectState, DISCONNECT_POLICY_VERSION as version } from '../base44/shared/disconnectPolicy.js';

const iso = ms => new Date(ms).toISOString();
const t = Date.parse('2026-11-24T12:00:00Z');
const match = {id:'m',player1_id:'white',player2_id:'black',clock_initial_ms:600000,time_control:'rapid'};
const initial = () => ({id:'g',match_id:'m',launch_epoch:2,status:'active',fen:'position b - - 0 15',
  turn_started_at:iso(t),white_time_ms:400000,black_time_ms:400000,
  white_last_seen_at:iso(t),black_last_seen_at:iso(t-21000)});
let record, writes, now=t, caller='white', beforeUpdateRead=null;
const strip = s => s.replace(/^import[^\n]+\n/gm,'');
const guardCode = (await transform(strip(await readFile('base44/shared/gameMutationGuard.ts','utf8')),{loader:'ts',format:'esm'})).code.replace('export {\n  guardGameMutations\n};','');
const locks=new Map();
const guard = new Function('acquireMatchLock','releaseMatchLock','refreshContestLocks','crypto',guardCode+'\nreturn guardGameMutations;')(
  async(key,owner)=>{if(locks.has(key))return false;locks.set(key,owner);return true;},
  async(key,owner)=>{if(locks.get(key)===owner)locks.delete(key);},
  async(key,ids,owner)=>locks.get(key)===owner,webcrypto);
const entity={get:async()=>{if(beforeUpdateRead){const fn=beforeUpdateRead;beforeUpdateRead=null;fn();}return structuredClone(record);},
  update:async(id,patch)=>{writes++;record={...record,...structuredClone(patch)};return structuredClone(record);}};
const client=()=>({auth:{me:async()=>caller?{id:caller}:null},asServiceRole:{entities:{Game:entity,Match:{get:async()=>match}}}});
const reset=()=>{record=initial();writes=0;now=t;caller='white';locks.clear();};
const policy=()=>checkDisconnectTimeout(guard(client()),record,match,now);
reset();
await policy();
assert.equal(record.black_disconnected_at,iso(t));
assert.equal(record.black_disconnect_policy_version,version);
assert.equal(getDisconnectState(match,record).black.deadlineMs,t+68000,'rapid grace and confirmation share one deadline');
assert.equal(record.disconnect_timeout_candidate_at,iso(t+60000));
now=t+67999;record.white_last_seen_at=iso(now);await policy();
assert.equal(record.status,'active','never forfeit before the complete countdown');
now=t+68000;record.white_last_seen_at=iso(now);await policy();
assert.equal(record.status,'completed');assert.equal(record.winner_id,'white');
assert.equal(record.end_reason,'disconnect_timeout');
assert.equal(record.black_time_ms,332000);
assert.deepEqual(getDisconnectState(match,record),{white:null,black:null});
const completed=structuredClone(record);await policy();assert.deepEqual(record,completed,'completed result is immutable');

reset();await policy();now=t+68000;
record.white_last_seen_at=iso(now);record.black_last_seen_at=iso(now-1);
await policy();
assert.equal(record.status,'active','fresh contact cancels a due result');
assert.equal(record.black_disconnected_at,'');
assert.equal(getDisconnectState(match,record).black,null);

reset();await policy();now=t+68000;await policy();
assert.equal(record.status,'active','both offline cannot produce a disconnect victory');
reset();record.fen='position w - - 0 15';await policy();
assert.equal(getDisconnectState(match,record).black.deadlineMs,null,'non-moving opponent has no active deadline');
record.fen='position b - - 0 15';record.turn_started_at=iso(t+50000);now=t+50000;record.white_last_seen_at=iso(now);
await policy();assert.equal(getDisconnectState(match,record).black.deadlineMs,t+118000,'new turn gets the full return window');

reset();record.black_disconnected_at=iso(t-100000);record.black_disconnect_policy_version='chesscom-reconnect-v1';await policy();
assert.equal(getDisconnectState(match,record).black.deadlineMs,t+68000,'migration never shortens an existing player window');
reset();await policy();now=t+68000;record.white_last_seen_at=iso(now);record.black_time_ms=10000;
assert.equal((await policy()).clockExpired,true);assert.equal(record.status,'active','ordinary clock expiry keeps its material-aware path');
const offset={...initial(),black_disconnected_at:'2026-11-24T07:00:00-05:00',black_disconnect_policy_version:version};
assert.equal(getDisconnectState(match,offset).black.deadlineMs,t+68000,'explicit timezone offsets are honored');

// Simulate a returning heartbeat between the timeout's final read and lease.
reset();await policy();now=t+68000;record.white_last_seen_at=iso(now);
const sweep=guard(client());await sweep.asServiceRole.entities.Game.get('g');
beforeUpdateRead=()=>{record.black_last_seen_at=iso(now);record.black_disconnected_at='';};
await assert.rejects(sweep.asServiceRole.entities.Game.update('g',{status:'completed',end_reason:'disconnect_timeout'}),/connection changed/);
assert.equal(record.status,'active');
// An unrelated presence change must still not reject a valid move.
const move=guard(client());await move.asServiceRole.entities.Game.get('g');
record.white_last_seen_at=iso(now+1);
await move.asServiceRole.entities.Game.update('g',{fen:'position w - - 0 16'});
assert.equal(record.fen,'position w - - 0 16');

// Exercise the actual heartbeat handler: return before evaluation, authorization,
// simultaneous contacts and terminal records, without touching production data.
let heartbeat;
const NativeDate=Date;
class FakeDate extends NativeDate { static now(){return now;} }
new Function('Deno','createClientFromRequest','guardGameMutations','checkDisconnectTimeout','getDisconnectState','Date',
  strip(await readFile('base44/functions/gameHeartbeat/entry.ts','utf8')))(
    {serve:fn=>{heartbeat=fn;}},client,guard,checkDisconnectTimeout,getDisconnectState,FakeDate);
const req=()=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify({gameId:'g'})});
reset();await policy();now=t+68001;record.white_last_seen_at=iso(now);caller='black';
assert.equal((await heartbeat(req())).status,200);
assert.equal(record.status,'active','a returning player may resume until a result actually commits');
assert.equal(record.black_disconnected_at,'');
assert.equal(record.black_last_seen_at,iso(now));
record.status='completed';record.end_reason='disconnect_timeout';record.winner_id='white';
const terminal=structuredClone(record);
assert.equal((await heartbeat(req())).status,200);assert.deepEqual(record,terminal);
caller='outsider';assert.equal((await heartbeat(req())).status,403,'completed data is participant-authorized too');
caller=null;assert.equal((await heartbeat(req())).status,401);
reset();record.black_last_seen_at=iso(now);
const responses=await Promise.all([heartbeat(req()),heartbeat(req())]);
assert.ok(responses.every(r=>[200,409].includes(r.status)));
assert.equal(record.status,'active');
console.log('Disconnect deadlines, migration, timezone offsets, clock precedence, both offline, reconnect races, heartbeat ordering and authorization passed.');
