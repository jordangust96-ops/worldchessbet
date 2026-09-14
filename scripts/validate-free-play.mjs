import assert from 'node:assert/strict';
import {fixture,check,equal,rejected,assertionCount} from './free-play-test-fixture.mjs';
const bodyFor=(f,extra={})=>({playMode:'free',entryAmount:0,serviceFee:0,agree:true,consentVersion:f.policy.CHALLENGE_HUD_CONSENT_VERSION,timeControl:'blitz',publiclyListed:true,requestKey:'free_creation_123456',...extra});
async function call(f,who,action,body={}) {return (await f.makeSdk(who).functions.invoke('manageChallenge',{action,...body})).data;}
async function made(f,extra={}) {return (await call(f,'p1','create',bodyFor(f,extra))).match;}
async function available(f,m) {await call(f,'p1','presence',{inviteCode:f.get(m.id).invite_code,presenceId:'free_creator_presence_123456',visible:true});return f.get(m.id);}
async function accepted(f,m,who='p2') {await call(f,who,'accept',{inviteCode:f.get(m.id).invite_code,agree:true,entryAmount:0,serviceFee:0});return f.get(m.id);}
async function started(f,m){for(const who of ['p1','p2'])await call(f,who,'ready',{matchId:m.id,presenceId:'free_ready_session_123456'});await call(f,'p1','finalize',{matchId:m.id});return f.table('Game')[0];}
function noMoney(f){equal(f.state.lookups,0,'No location request');equal(f.state.creationLookups||0,0);equal(f.table('LedgerJournalBatch').length,0);equal(f.table('WalletTransaction').length,0);equal(f.table('LedgerEntry').length,4,'Seed money untouched');equal(f.barriers.size,0);}
function freeFixture(){const f=fixture();f.state.location=false;f.state.paid=false;f.state.noMoney=true;for(const u of f.table('User'))Object.assign(u,{verified:false,account_state:'unverified',withdrawal_hold:true});f.table('Wallet').length=0;f.table('SeamlessBankAccount').length=0;return f;}
for(const publiclyListed of [false,true])for(const timeControl of ['blitz','rapid','classical'])for(const end of ['resignation','draw','checkmate','timeout']){
 const f=freeFixture(),m=await made(f,{publiclyListed,timeControl});equal(m.play_mode,'free');equal(m.wager_amount,0);equal(m.platform_service_fee,0);equal(m.player1_deposited,false);
 const replay=await made(f,{publiclyListed,timeControl});equal(replay.id,m.id);
 await available(f,m);await accepted(f,m);equal(f.get(m.id).status,'preparing');equal(f.get(m.id).player2_deposited,false);
 const game=await started(f,m);equal(game.play_mode,'free');equal(game.white_time_ms,{blitz:180000,rapid:600000,classical:900000}[timeControl]);equal(f.get(m.id).status,'in_progress');
 const anchor=game.turn_started_at;await call(f,'p2','finalize',{matchId:m.id});equal(f.table('Game').length,1);equal(f.table('Game')[0].turn_started_at,anchor);
 if(end==='resignation')await f.makeSdk('p1').functions.invoke('resignGame',{gameId:game.id});
 if(end==='draw'){await f.makeSdk('p1').functions.invoke('respondDraw',{gameId:game.id,action:'offer'});await f.makeSdk('p2').functions.invoke('respondDraw',{gameId:game.id,action:'accept'});}
 if(end==='checkmate'){for(const [who,from,to] of [['p1','f2','f3'],['p2','e7','e5'],['p1','g2','g4'],['p2','d8','h4']]){f.state.now+=1000;await f.makeSdk(who).functions.invoke('submitMove',{gameId:game.id,from,to});}}
 if(end==='timeout'){f.state.now+=game.white_time_ms+5000;await f.makeSdk('p2').functions.invoke('checkTimeout',{gameId:game.id});}
 equal(f.table('Game')[0].status,'completed');equal(f.table('Game')[0].end_reason,end==='draw'?'draw_agreement':end);
 await Promise.all(['p1','p2','p1'].map(who=>f.makeSdk(who).functions.invoke('settleMatch',{gameId:game.id})));equal(f.get(m.id).status,'completed');equal(f.get(m.id).result,end==='draw'?'draw':'player2_win');
 noMoney(f);
}
for(const phase of ['open','accepted','expired','no_show']){
 const f=freeFixture(),m=await made(f);await available(f,m);if(['accepted','no_show'].includes(phase))await accepted(f,m);
 if(phase==='expired')f.state.now+=86400001;if(phase==='no_show')f.state.now+=120001;
 if(['expired','no_show'].includes(phase))await call(f,'p1','recover',{matchId:m.id});else await call(f,phase==='accepted'?'p2':'p1','cancel',{matchId:m.id});
 equal(f.get(m.id).status,'cancelled');await call(f,'p1','cancel',{matchId:m.id});equal(f.table('Game').length,0);noMoney(f);
}
{
 const f=freeFixture(),m=await made(f);await available(f,m);
 await Promise.allSettled(['p2','p3','p4'].map(who=>accepted(f,m,who)));check(['p2','p3','p4'].includes(f.get(m.id).player2_id));equal(f.table('Match').length,1);noMoney(f);
}
{
 const f=freeFixture(),m=await made(f);await available(f,m);await accepted(f,m);
 for(const who of ['p1','p2'])await assert.rejects(()=>call(f,who,'create',bodyFor(f,{requestKey:'another_match_123456'})));
 const other=await call(f,'p3','create',bodyFor(f,{requestKey:'other_match_123456'}));
 await assert.rejects(()=>accepted(f,other.match,'p2'));noMoney(f);
}
for(const patch of [{entryAmount:5},{serviceFee:2},{entryAmount:'0'},{agree:false},{playMode:'FREE'},{playMode:null},{playMode:'money'},{playMode:undefined}]){
 const f=freeFixture();await assert.rejects(()=>made(f,patch));equal(f.table('Match').length,0);noMoney(f);
}
for(const phase of ['create','accept','ready','finalize']){
 const f=freeFixture();if(phase==='create'){f.table('User')[0].account_state='suspended';await assert.rejects(()=>made(f));}
 else {const m=await made(f);await available(f,m);if(phase==='accept'){f.table('User')[1].account_state='closed';await assert.rejects(()=>accepted(f,m));}
 else {await accepted(f,m);if(phase==='ready'){f.table('User')[1].account_state='suspended';await assert.rejects(()=>call(f,'p2','ready',{matchId:m.id,presenceId:'free_ready_session_123456'}));}
 else {for(const who of ['p1','p2'])await call(f,who,'ready',{matchId:m.id,presenceId:'free_ready_session_123456'});f.table('User')[0].account_state='suspended';await assert.rejects(()=>call(f,'p2','finalize',{matchId:m.id}));}}}
 equal(f.table('Game').length,0);noMoney(f);
}
{
 const f=freeFixture(),m=await made(f);await available(f,m);await accepted(f,m);
 for(const who of ['p1','p2'])await call(f,who,'ready',{matchId:m.id,presenceId:'free_ready_session_123456'});
 f.state.fail={where:'Match.update',test:(_id,p)=>p.status==='in_progress'};
 await assert.rejects(()=>call(f,'p1','finalize',{matchId:m.id}));equal(f.table('Game').length,1);const anchor=f.table('Game')[0].turn_started_at;f.state.now+=35000;
 await call(f,'p2','finalize',{matchId:m.id});equal(f.get(m.id).status,'in_progress');equal(f.table('Game').length,1);equal(f.table('Game')[0].turn_started_at,anchor);noMoney(f);
}
{
 const f=freeFixture(),m=await made(f);await available(f,m);await accepted(f,m);
 await call(f,'p1','ready',{matchId:m.id,presenceId:'free_ready_session_123456'});await call(f,'p1','finalize',{matchId:m.id});equal(f.table('Game').length,0);
 await call(f,'p2','ready',{matchId:m.id,presenceId:'free_ready_session_123456'});f.state.now+=10001;await call(f,'p1','finalize',{matchId:m.id});equal(f.table('Game').length,0);noMoney(f);
}
// Current money location is checked explicitly using original request evidence; it never creates a match.
for(const approved of [false,true]){
 const f=fixture();f.state.location=approved;
 const res=await f.load('base44/functions/manageChallenge/entry.ts').handler(new Request('https://example.invalid',{method:'POST',headers:{'cf-connecting-ip':'198.51.100.5','user-agent':'test-browser'},body:JSON.stringify({action:'money_location',approved:true})}));
 equal(res.status,200);const data=await res.json();equal(data.approved,approved);check(data.message.includes(approved?'wallet setup':'free'));equal(f.table('Match').length,0);equal(f.state.lookups,1);
}
console.log(`Free play: ${assertionCount()} assertions passed; actual create, acceptance, ready, start, gameplay and completion handlers; no financial reads/writes or location calls during free games.`);
// Pending deposits/clearing balances stay unchanged, and free play never takes a wallet lock.
{
 const f=freeFixture();f.table('Wallet').push({id:'pending-wallet',user_id:'p1',available_balance:0,held_balance:500,pending_balance:500});
 const snapshot=JSON.stringify(f.table('Wallet'));f.atomic.acquireUserWalletLock=async()=>{throw Error('Free play tried a wallet lock');};
 const m=await made(f);await available(f,m);await accepted(f,m);await started(f,m);equal(JSON.stringify(f.table('Wallet')),snapshot);noMoney(f);
}
for(const patch of [{platform_service_fee:1},{wager_amount:5},{player1_deposited:true},{challenge_operation_state:'reserving',challenge_claimant_id:'p2'}]){
 const f=freeFixture(),m=await made(f);await available(f,m);Object.assign(f.table('Match')[0],patch);
 await assert.rejects(()=>accepted(f,m));equal(f.get(m.id).player2_id,undefined);noMoney(f);
}
{
 const f=freeFixture(),m=await made(f);await available(f,m);f.state.now+=10001;
 await assert.rejects(()=>accepted(f,m));equal(f.get(m.id).player2_id,undefined);noMoney(f);
}
{
 const f=freeFixture(),m=await made(f);await available(f,m);
 const original=f.atomic.refreshContestLocks;f.atomic.refreshContestLocks=async(id,...args)=>id.startsWith('challenge-creation:')?false:original(id,...args);
 await assert.rejects(()=>accepted(f,m));equal(f.get(m.id).player2_id,undefined);noMoney(f);
}
for(const patch of [{play_mode:'money'},{winner_id:'p1'},{result:'unfinished'},{player2_id:'p3'}]){
 const f=freeFixture(),m=await made(f);await available(f,m);await accepted(f,m);const game=await started(f,m);
 await f.makeSdk('p1').functions.invoke('resignGame',{gameId:game.id});Object.assign(f.table('Game')[0],patch);
 await assert.rejects(()=>f.makeSdk('p1').functions.invoke('settleMatch',{gameId:game.id}));equal(f.get(m.id).status,'in_progress');noMoney(f);
}
for(const who of ['missing','mfa-needed']){
 const f=freeFixture();if(who==='mfa-needed')f.table('User').push({id:who,account_state:'unverified'});
 await assert.rejects(()=>call(f,who,'create',bodyFor(f)));equal(f.table('Match').length,0);noMoney(f);
}
for(const [action,resolutionType] of [['place_pre_settlement_hold'],['place_post_settlement_hold'],['place_account_hold'],['release_hold'],['resolve_case','funds_forfeited'],['resolve_case','contest_reversed'],['resolve_case','contest_voided']]){
 const f=freeFixture(),m=await made(f);f.table('User')[0].role='admin';f.table('DisputeCase').push({id:'case',match_id:m.id,status:'open'});
 const res=await f.load('base44/functions/manageDisputeCase/entry.ts').handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({caseId:'case',action,payload:{resolutionType,amount:100}})}));
 equal(res.status,409);check((await res.json()).error.includes('Free games'));noMoney(f);
}
console.log(`Including free-game tampering, pending funds, lease loss, session restrictions and administrative financial guards: ${assertionCount()} assertions passed.`);

{
 const f=freeFixture(),m=await made(f);await available(f,m);await accepted(f,m);
 Object.assign(f.table('User')[0],{role:'admin',email:'fixture@example.invalid'});
 await f.makeSdk('p1').functions.invoke('notifyMatchAccepted',{matchId:m.id});
 equal(f.state.emails.length,1);check(f.state.emails[0].body.includes('Free play'));check(!f.state.emails[0].body.includes('Entry Amount'));noMoney(f);
}
console.log('Including captured notification copy (no external email): '+assertionCount()+' assertions passed.');
