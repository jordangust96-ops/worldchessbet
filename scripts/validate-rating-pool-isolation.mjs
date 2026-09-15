import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
export function setup(){const f=fixture();f.state.noMoney=true;f.table('User')[0].role='admin';f.table('RatingSystemConfig').push({id:'config',config_key:'primary',processing_enabled:true,public_enabled:true,history_start_at:'2026-09-01T00:00:00Z',current_generation:0,algorithm_version:'glicko2_sequential_v1',initial_rating:1500,initial_rating_deviation:350,initial_volatility:0.06,tau:0.5,provisional_games:10});return f;}
export function game(f,id,pool,minute=0){const mid='m-'+id,gid='g-'+id,stamp=new Date(f.state.now-3600000+minute*60000).toISOString();f.table('Match').push({id:mid,challenge_version:1,is_private:true,play_mode:'free',wager_amount:0,platform_service_fee:0,status:'completed',result:'player1_win',game_id:gid,player1_id:'p1',player2_id:'p2',winner_id:'p1',time_control:pool});f.table('Game').push({id:gid,match_id:mid,play_mode:'free',status:'completed',result:'white_win',player1_id:'p1',player2_id:'p2',winner_id:'p1'});f.table('ContestRecord').push({id,match_id:mid,game_id:gid,play_mode:'free',time_control:pool,white_player_id:'p1',black_player_id:'p2',winner_id:'p1',entry_amount:0,contest_pool:0,platform_fee:0,platform_fee_per_player:0,winner_payout:0,ledger_entry_ids:[],wallet_transaction_ids:[],settlement_timestamp:stamp});}

let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
for(const blocker of ['dispute','integrity','duplicate_operation']){
 const f=setup();game(f,'first-blitz','blitz');game(f,'first-rapid','rapid',1);game(f,'second-blitz','blitz',2);game(f,'first-classical','classical',3);
 if(blocker==='dispute')f.table('DisputeCase').push({id:'review',match_id:'m-first-blitz',status:'open'});
 if(blocker==='integrity')f.table('IntegrityFlag').push({id:'review',match_id:'m-first-blitz',status:'under_review'});
 if(blocker==='duplicate_operation')for(const id of ['duplicate1','duplicate2'])f.table('RatingOperation').push({id,operation_key:'rating-operation:first-blitz',status:'prepared'});
 const result=await f.makeSdk('p1').functions.invoke('processEligibleRatings',{});
 eq(result.data.applied,2);eq(f.table('PlayerRating').map(r=>r.time_control).sort(),['classical','classical','rapid','rapid']);
 eq(f.table('RatingEvent').length,4);eq(result.data.deferred,blocker==='duplicate_operation'?1:2);
 if(blocker!=='duplicate_operation'){
  if(blocker==='dispute')f.table('DisputeCase')[0].status='closed';else f.table('IntegrityFlag')[0].status='resolved';
  const replay=await f.makeSdk('p1').functions.invoke('processEligibleRatings',{});eq(replay.data.applied,2);
  eq(f.table('PlayerRating').filter(r=>r.time_control==='blitz').map(r=>r.games_rated),[2,2]);
  const ops=f.table('RatingOperation').filter(r=>r.time_control==='blitz').sort((a,b)=>a.rating_eligible_at.localeCompare(b.rating_eligible_at));
  eq(ops[1].player1_games_before,1);eq(ops[1].player1_rating_before,ops[0].player1_rating_after);eq(ops[1].player2_rating_before,ops[0].player2_rating_after);
  await f.makeSdk('p1').functions.invoke('processEligibleRatings',{});eq(f.table('RatingEvent').length,8);
 }
 eq(f.table('WalletTransaction').length,0);eq(f.table('LedgerJournalBatch').length,0);
}
{
 const f=setup();game(f,'blitz','blitz');game(f,'rapid','rapid',1);
 eq((await f.makeSdk('p1').functions.invoke('processEligibleRatings',{})).data.applied,2);
 const before=f.table('PlayerRating').find(r=>r.user_id==='p1'&&r.time_control==='blitz').rating;
 eq(before,1662.310894);eq(f.table('PlayerRating').find(r=>r.user_id==='p1'&&r.time_control==='rapid').rating,before);
 game(f,'blitz-rematch','blitz',2);eq((await f.makeSdk('p1').functions.invoke('processEligibleRatings',{})).data.applied,1);
 const blitz=f.table('PlayerRating').find(r=>r.user_id==='p1'&&r.time_control==='blitz'),rapid=f.table('PlayerRating').find(r=>r.user_id==='p1'&&r.time_control==='rapid');
 eq(blitz.games_rated,2);eq(rapid.games_rated,1);eq(rapid.rating,before);assert.ok(blitz.rating>before);checks++;
}
console.log('Rating pool isolation, first-game symmetry, continued ratings and replay: '+checks+' checks passed.');
