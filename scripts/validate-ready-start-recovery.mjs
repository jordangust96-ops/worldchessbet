import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
const attest=f=>({action:'ready',presenceId:'ready_session_123456',agree:true,attestationVersion:f.policy.FAIR_PLAY_ATTESTATION_VERSION});
for(const failure of ['Game.create.before','Game.create.after']){
 const f=fixture(),m=await f.create();
 await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);
 for(const id of ['p1','p2'])await f.api.readyChallenge(f.request,f.sdk,f.user(id),m.id,attest(f));
 const journals=f.table('LedgerJournalBatch').length;
 f.state.fail={where:failure};
 await assert.rejects(()=>f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id));
 await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);
 const game=f.table('Game')[0],anchor=game.turn_started_at;
 await f.api.finalizeChallengeStart(f.sdk,f.user('p2'),m.id);
 assert.equal(f.table('Game').length,1);assert.equal(f.get(m.id).status,'in_progress');
 assert.equal(f.table('Game')[0].turn_started_at,anchor);assert.equal(f.table('LedgerJournalBatch').length,journals);
 console.log('PASS '+failure+': one game, same clock, no extra reservations');
}
{
 const f=fixture(),m=await f.create();
 await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),m,f.consent);
 for(const id of ['p1','p2'])await f.api.readyChallenge(f.request,f.sdk,f.user(id),m.id,attest(f));
 const reads=f.state.reads.length;
 await f.api.readyChallenge(f.request,f.sdk,f.user('p1'),m.id,{action:'heartbeat',visible:true,presenceId:'ready_session_123456'});
 assert.ok(!f.state.reads.slice(reads).some(x=>/Identity|Socure/.test(x)));
 f.table('User').find(u=>u.id==='p1').account_state='suspended';
 await assert.rejects(()=>f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id),e=>e.code==='account_restricted');
 assert.equal(f.table('Game').length,0);
 f.state.now+=11000;
 const beat=await f.api.readyChallenge(f.request,f.sdk,f.user('p1'),m.id,{action:'heartbeat',visible:true,presenceId:'ready_session_123456'});
 assert.equal(beat.needsReady,true);
 console.log('PASS heartbeat optimization preserves final account restrictions and ready expiry');
}
