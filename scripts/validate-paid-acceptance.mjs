import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
const presence={presenceId:'paid_creator_presence_123456',visible:true};
const accept=f=>f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),f.get(f.table('Match')[0].id),f.consent);
for(const delay of [0,12000,7200000]){
 const f=fixture(),m=await f.create();f.state.now+=delay;
 const result=await accept(f);assert.equal(result.accepted,true);
 const current=f.get(m.id);assert.equal(Date.parse(current.challenge_start_deadline_at)-f.state.now,300000);
 assert.equal(f.table('LedgerJournalBatch').length,2);
 assert.equal(f.table('Wallet').find(w=>w.user_id==='p1').available_balance,73);
 assert.equal(f.table('Wallet').find(w=>w.user_id==='p2').available_balance,73);
 f.state.now+=180000;await accept(f);
 assert.equal(f.get(m.id).challenge_start_deadline_at,current.challenge_start_deadline_at);
 await f.api.recoverChallenge(f.sdk,m.id);assert.equal(f.get(m.id).status,'preparing');
 f.state.now+=120001;await f.api.recoverChallenge(f.sdk,m.id);await f.api.recoverChallenge(f.sdk,m.id);
 assert.equal(f.get(m.id).status,'cancelled');
 for(const id of ['p1','p2']){const w=f.table('Wallet').find(w=>w.user_id===id);assert.equal(w.available_balance,100);assert.equal(w.held_balance,0);}
 console.log('PASS offline acceptance '+delay+'ms; fixed five-minute deadline, replay and exactly-once refund');
}
{
 const f=fixture(),m=await f.create();await accept(f);f.state.now+=240000;
 for(const id of ['p1','p2'])await f.api.readyChallenge(f.request,f.sdk,f.user(id),m.id,{action:'ready',presenceId:'return_ready_123456',agree:true,attestationVersion:f.policy.FAIR_PLAY_ATTESTATION_VERSION});
 await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);assert.equal(f.table('Game').length,1);assert.equal(f.get(m.id).status,'in_progress');
 assert.equal(f.table('LedgerJournalBatch').length,2);console.log('PASS creator returns after four minutes; both attest and start without another debit');
}
for(const active of [false,true]){
 const f=fixture(),m=await f.create();await accept(f);
 Object.assign(f.table('User')[0],{role:'admin',email:'fixture@example.invalid',last_active_at:active?new Date(f.state.now).toISOString():''});
 await Promise.all(['p1','p1'].map(id=>f.makeSdk(id).functions.invoke('notifyMatchAccepted',{matchId:m.id})));
 await f.makeSdk('p1').functions.invoke('notifyMatchAccepted',{matchId:m.id});
 assert.equal(f.state.emails.length,1);assert.match(f.state.emails[0].body,/Return before/);assert.match(f.state.emails[0].body,new RegExp('/play\\?match='+m.id));
 assert.equal(f.get(m.id).accept_notification_sent,true);
 console.log('PASS acceptance email for '+(active?'online':'offline')+' host, direct match link and concurrent deduplication');
}
for(const status of ['cancelled','completed','in_progress']){
 const f=fixture(),m=await f.create();await accept(f);
 Object.assign(f.table('User')[0],{role:'admin',email:'fixture@example.invalid'});
 f.table('Match')[0].status=status;await f.makeSdk('p1').functions.invoke('notifyMatchAccepted',{matchId:m.id});
 assert.equal(f.state.emails.length,0);console.log('PASS no stale email for '+status);
}
for(const issue of ['funds','pending','fee','identity','bank','location','consent','restricted','expired']){
 const f=fixture(),m=await f.create();await f.api.maintainCreatorPresence(f.request,f.sdk,f.user('p1'),m,presence);
 let expected;
 if(['funds','pending','fee'].includes(issue)){f.balance('p2',issue==='fee'?25:0);expected='funds_required';}
 if(issue==='pending')f.table('Wallet').find(w=>w.user_id==='p2').pending_balance=1000;
 if(issue==='identity'){f.table('User')[1].verified=false;expected='identity_required';}
 if(issue==='bank'){f.table('SeamlessBankAccount').splice(1,1);expected='bank_required';}
 if(issue==='location'){f.state.location=false;expected='location_required';}
 if(issue==='consent'){f.consent.agree=false;expected='consent_required';}
 if(issue==='restricted'){f.table('User')[1].account_state='suspended';expected='account_restricted';}
 if(issue==='expired'){f.state.now+=86400001;expected='unavailable';}
 await assert.rejects(()=>accept(f),e=>e.code===expected);
 assert.equal(f.table('LedgerJournalBatch').length,1);assert.equal(f.get(m.id).player2_id,undefined);
 console.log('PASS recipient '+issue+' rejected without reservation');
}
