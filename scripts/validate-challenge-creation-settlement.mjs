import {fixture,check,equal,assertionCount} from './free-play-test-fixture.mjs';
for(const end of ['resignation','draw']){
 const f=fixture(),m=await f.create();
 await f.api.maintainCreatorPresence(f.request,f.sdk,f.user('p1'),m,{presenceId:'creator_presence_123456',visible:true});
 await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),f.get(m.id),f.consent);
 for(const id of ['p1','p2'])await f.api.readyChallenge(f.request,f.sdk,f.user(id),m.id,{action:'ready',presenceId:'ready_session_123456',agree:true,attestationVersion:f.policy.FAIR_PLAY_ATTESTATION_VERSION});
 await f.api.finalizeChallengeStart(f.sdk,f.user('p1'),m.id);
 const game=f.table('Game')[0];
 if(end==='resignation')await f.makeSdk('p1').functions.invoke('resignGame',{gameId:game.id});
 else {await f.makeSdk('p1').functions.invoke('respondDraw',{gameId:game.id,action:'offer'});await f.makeSdk('p2').functions.invoke('respondDraw',{gameId:game.id,action:'accept'});}
 await f.makeSdk('p1').functions.invoke('settleMatch',{gameId:game.id}).catch(e=>{console.log(f.state.errors);throw e;});
 await f.makeSdk('p1').functions.invoke('settleMatch',{gameId:game.id});
 equal(f.get(m.id).status,'completed');equal(f.table('ContestRecord').length,1);
 const wallets=f.table('Wallet').filter(w=>['p1','p2'].includes(w.user_id));
 for(const wallet of wallets){
   equal(wallet.available_balance,end==='draw'?100:73);
   equal(wallet.held_balance,end==='draw'?0:wallet.user_id==='p2'?50:0);
 }
 const summary=f.load('base44/shared/challengeWalletSummary.ts').exports.challengeWalletSummary;
 equal((await summary(f.sdk,'p1')).reserved_for_matches,0);equal((await summary(f.sdk,'p2')).reserved_for_matches,0);
}
console.log('Staggered creator and recipient reservation settlement: '+assertionCount()+' assertions passed; actual start, game end and settlement; no external calls.');
