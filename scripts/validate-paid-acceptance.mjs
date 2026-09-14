import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
const presence={presenceId:'paid_creator_presence_123456',visible:true};
const accept=f=>f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),f.get(f.table('Match')[0].id),f.consent);
for(const phase of ['location','commit'])for(const host of ['present','left']){
 const f=fixture(),m=await f.create();
 await f.api.maintainCreatorPresence(f.request,f.sdk,f.user('p1'),m,presence);
 let injected=false;
 const update=async()=>{
   injected=true;f.state.now+=12000;
   await f.api.maintainCreatorPresence(f.request,f.sdk,f.user('p1'),f.get(m.id),{...presence,visible:host==='present'});
 };
 if(phase==='location'){
   const original=f.access.requireChallengePlayer;
   let checks=0;
   f.access.requireChallengePlayer=async(...args)=>{const r=await original(...args);if(++checks===1)await update();return r;};
 }else{
   const original=f.atomic.acquireLedgerLock;
   f.atomic.acquireLedgerLock=async(...args)=>{await update();return original(...args);};
 }
 if(host==='present'){
   const result=await accept(f);assert.equal(result.accepted,true);
   assert.equal(f.table('LedgerJournalBatch').length,2);
   assert.equal(f.table('Wallet').find(w=>w.user_id==='p1').available_balance,73);
   assert.equal(f.table('Wallet').find(w=>w.user_id==='p2').available_balance,73);
   await accept(f);assert.equal(f.table('LedgerJournalBatch').length,2);
 }else{
   await assert.rejects(()=>accept(f),e=>e.code==='creator_not_ready');
   assert.equal(f.table('LedgerJournalBatch').length,1);
   assert.equal(f.table('Wallet').find(w=>w.user_id==='p2').available_balance,100);
   assert.equal(f.barriers.size,0);
 }
 assert.equal(injected,true);console.log('PASS slow '+phase+' host '+host);
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
