import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
for(const free of [true,false])for(const enabled of [true,false]){
 const f=fixture();
 const m=free?(await f.api.createChallenge(f.sdk,f.user('p1'),{playMode:'free',creationVersion:f.policy.CHALLENGE_CREATION_VERSION,entryAmount:0,serviceFee:0,requestKey:'email_toggle_free_123'})).match:await f.create();
 assert.equal(m.notify_on_accept,true);
 const before=f.table('LedgerJournalBatch').length;
 const result=await f.makeSdk('p1').functions.invoke('updateMatchPreference',{matchId:m.id,notifyOnAccept:enabled});
 assert.deepEqual(Object.keys(result.data).sort(),['matchId','notifyOnAccept']);
 assert.equal(result.data.notifyOnAccept,enabled);
 assert.equal((await f.api.listMyChallenges(f.sdk,f.user('p1'))).challenges[0].notifyOnAccept,enabled);
 assert.equal((await f.api.viewChallenge(f.sdk,f.get(m.id),f.user('p1'))).challenge.notifyOnAccept,enabled);
 assert.equal((await f.api.viewChallenge(f.sdk,f.get(m.id),f.user('p2'))).challenge.notifyOnAccept,undefined);
 assert.equal(f.table('LedgerJournalBatch').length,before);
 await assert.rejects(()=>f.makeSdk('p2').functions.invoke('updateMatchPreference',{matchId:m.id,notifyOnAccept:!enabled}),e=>e.response.status===403);
 await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),f.get(m.id),{agree:true,entryAmount:free?0:25,serviceFee:free?0:2});
 await assert.rejects(()=>f.makeSdk('p1').functions.invoke('updateMatchPreference',{matchId:m.id,notifyOnAccept:!enabled}),e=>e.response.status===409);
 Object.assign(f.table('User')[0],{role:'admin',email:'fixture@example.invalid'});
 await f.makeSdk('p1').functions.invoke('notifyMatchAccepted',{matchId:m.id});
 assert.equal(f.state.emails.length,enabled?1:0);
 console.log('PASS '+(free?'free':'paid')+' default on, owner-only persistence, acceptance freeze, email '+(enabled?'sent':'suppressed')+' in isolated adapter');
}
