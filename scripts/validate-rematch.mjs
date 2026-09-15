import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
function setup(free=false) {
 const f=fixture();
 f.table('Match').push({id:'finished',launch_epoch:2,status:'completed',player1_id:'p1',player2_id:'p2',play_mode:free?'free':'money',wager_amount:free?0:25,platform_service_fee:free?0:2,time_control:'blitz'});
 const call=(id,action,body={})=>f.load('base44/shared/rematchControl.ts').exports.rematchControl(f.request,f.sdk,f.user(id),{action:'rematch_'+action,matchId:'finished',screenId:'screen_session_for_'+id,entryAmount:free?0:25,serviceFee:free?0:2,agree:true,requestKey:'rematch_request_123456',...body});
 const enter=async()=>{await call('p1','enter');await call('p2','enter');};
 return {...f,call,enter};
}
for(const free of [true,false]) for(const elapsed of [29999,30000]) {
 const f=setup(free);await f.enter();
 const sent=await f.call('p1','request');
 assert.equal(Date.parse(sent.offer.expiresAt)-f.state.now,30000);
 f.state.now+=29000;await f.enter(); // Keep presence fresh; test the offer deadline itself.
 f.state.now+=elapsed-29000;
 if(elapsed<30000) assert.equal((await f.call('p2','accept',{offerId:sent.offer.id})).offer.status,'accepted');
 else {
  await assert.rejects(()=>f.call('p2','accept',{offerId:sent.offer.id}));
  assert.equal((await f.call('p1','poll')).offer.status,'closed');
  assert.equal(f.get(sent.offer.id).status,'cancelled');
  assert.equal(f.table('Wallet')[0].available_balance,100);
 }
 console.log('PASS '+(free?'free':'money')+' 30-second offer boundary at '+elapsed+'ms');
}
for(const free of [true,false]) {
 const f=setup(free);await f.enter();
 if(free)f.state.noMoney=true;
 const sent=await f.call('p1','request');
 assert.equal(sent.offer.status,'pending');assert.equal(sent.offer.incoming,false);
 const received=await f.call('p2','poll');assert.equal(received.offer.id,sent.offer.id);assert.equal(received.offer.incoming,true);
 const crossing=await f.call('p2','request');assert.equal(crossing.offer.id,sent.offer.id);assert.equal(f.table('Match').length,2);
 const c=f.get(sent.offer.id);assert.equal(c.challenge_publicly_listed,false);assert.equal(c.notify_on_accept,false);
 assert.equal(f.table('LedgerJournalBatch').length,free?0:1);
 await assert.rejects(()=>f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),c,{agree:true,entryAmount:c.wager_amount,serviceFee:c.platform_service_fee}),e=>e.code==='result_screen_required');
 const accepted=await f.call('p2','accept',{offerId:c.id});
 assert.equal(accepted.offer.status,'accepted');assert.equal((await f.call('p1','poll')).offer.matchId,c.id);
 await f.call('p2','accept',{offerId:c.id});await f.call('p1','leave');
 assert.equal(f.get(c.id).status,'preparing');assert.equal(f.table('LedgerJournalBatch').length,free?0:2);
 assert.equal(f.table('Match').length,2);assert.equal(f.table('Game').length,0);
 console.log('PASS '+(free?'free':'paid')+' offers, crossing requests, accept replay, private target and shared ready screen');
}
for(const end of ['decline','cancel','leave','stale','expiry','new_screen']) {
 const f=setup();await f.enter();const sent=await f.call('p1','request'),id=sent.offer.id;
 if(end==='decline')await f.call('p2','decline',{offerId:id});
 if(end==='cancel')await f.call('p1','cancel',{offerId:id});
 if(end==='leave')await f.call('p2','leave');
 if(end==='stale'){f.state.now+=31000;await f.call('p1','poll');}
 if(end==='expiry'){f.state.now+=30001;await f.api.recoverChallenge(f.sdk,id);}
 if(end==='new_screen')await f.call('p2','enter',{screenId:'a_different_screen_session'});
 await f.call('p1','poll');
 assert.equal(f.get(id).status,'cancelled');
 assert.equal(f.table('Wallet').find(w=>w.user_id==='p1').available_balance,100);
 assert.equal(f.table('Wallet').find(w=>w.user_id==='p1').held_balance,0);
 const batches=f.table('LedgerJournalBatch').length;await f.call('p1','poll');assert.equal(f.table('LedgerJournalBatch').length,batches);
 await assert.rejects(()=>f.call('p2','accept',{offerId:id}));
 console.log('PASS '+end+' closes offer and releases creator reservation once');
}
for(const issue of ['outsider','absent','forged_terms','identity','bank','funds','location','wrong_offer','own_accept']) {
 const f=setup();await f.enter();let act;
 if(issue==='outsider')act=()=>f.call('p3','request');
 if(issue==='absent'){await f.call('p2','leave');act=()=>f.call('p1','request');}
 if(issue==='forged_terms')act=()=>f.call('p1','request',{entryAmount:5});
 if(['identity','bank','funds','location'].includes(issue)) {
  if(issue==='identity')f.table('User')[0].verified=false;
  if(issue==='bank')f.table('SeamlessBankAccount').splice(0,1);
  if(issue==='funds')f.balance('p1',0);
  if(issue==='location')f.state.location=false;
  act=()=>f.call('p1','request');
 }
 if(['wrong_offer','own_accept'].includes(issue)){const sent=await f.call('p1','request');act=()=>f.call(issue==='own_accept'?'p1':'p2','accept',{offerId:issue==='wrong_offer'?'other':sent.offer.id});}
 await assert.rejects(act);assert.equal(f.table('Match').filter(m=>m.player2_id && m.status==='preparing').length,0);
 console.log('PASS rejects '+issue);
}
{
 const f=setup();await f.enter();
 await f.call('p2','leave');await f.call('p2','poll');
 assert.equal(f.get('finished').post_match_player2_presence.left,true);
 await assert.rejects(()=>f.call('p1','request'));
 console.log('PASS late heartbeat cannot reopen a departed screen');
}
{
 const f=setup();await f.enter();
 const results=await Promise.allSettled([f.call('p1','request'),f.call('p2','request')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(f.table('Match').length,2);assert.equal(f.table('LedgerJournalBatch').length,1);
 console.log('PASS simultaneous requests make one offer');
}
{
 const f=setup();await f.enter();
 f.state.fail={where:'Match.create.after'};
 await assert.rejects(()=>f.call('p1','request'));
 const child=f.table('Match').find(m=>m.id!=='finished');assert.ok(child);
 f.state.now+=180001;
 await f.api.recoverChallenge(f.sdk,child.id);
 assert.equal(f.get(child.id).status,'cancelled');
 assert.equal(f.table('Wallet')[0].available_balance,100);
 console.log('PASS lost creation response remains recoverable');
}

for(const id of ['p1','p2'])for(const amount of [25,26.99,27]) {
 const f=setup();await f.enter();f.balance(id,amount);
 if(id==='p1') {
  if(amount<27){await assert.rejects(()=>f.call('p1','request'),e=>e.code==='funds_required');assert.equal(f.table('Match').length,1);}
  else assert.equal((await f.call('p1','request')).offer.status,'pending');
 } else {
  const sent=await f.call('p1','request');
  if(amount<27)await assert.rejects(()=>f.call('p2','accept',{offerId:sent.offer.id}),e=>e.code==='funds_required');
  else assert.equal((await f.call('p2','accept',{offerId:sent.offer.id})).offer.status,'accepted');
 }
 console.log('PASS entry plus fee boundary '+id+' '+amount);
}
{
 const f=setup();Object.assign(f.table('Match')[0],{platform_service_fee:1.75,platform_fee_schedule_version:'historical',clock_initial_ms:240000,display_name:'Original clock'});
 await f.enter();
 await assert.rejects(()=>f.call('p1','request'),e=>e.code==='terms_changed');
 const sent=await f.call('p1','request',{serviceFee:1.75});
 const m=f.get(sent.offer.id);assert.equal(m.platform_service_fee,1.75);assert.equal(m.wager_amount,25);
 assert.equal(m.clock_initial_ms,240000);assert.equal(m.platform_fee_schedule_version,'historical');
 assert.equal(m.display_name,'Original clock');
 await f.call('p2','accept',{offerId:m.id,serviceFee:1.75});
 assert.equal(f.table('Wallet')[0].available_balance,73.25);assert.equal(f.table('Wallet')[1].available_balance,73.25);
 console.log('PASS exact original entry, fee version and clock retained');
}
