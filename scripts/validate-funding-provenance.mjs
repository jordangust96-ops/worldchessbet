import assert from 'node:assert/strict';
import { transitionFunding, fundingSummary, sourceState } from '../base44/shared/fundingProvenancePure.js';
let assertions=0;
const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const fails=(fn,pattern)=>{assert.throws(fn,pattern);assertions++;};
const now=Date.parse('2026-09-14T17:00:00Z');
const source={id:'d',type:'deposit',status:'completed',deposit_hold_status:'released',deposit_withdrawal_status:'held',deposit_release_at:'2026-09-16T22:59:21Z',provider_last_status:'Processed'};
let sources={d:source};
const empty=()=>({available:[],held:{}});
let states={a:{available:[{cents:1000,sources:[]}],held:{'tx:d':[{cents:1000,sources:[]}]}},b:{available:[{cents:2000,sources:[]}],held:{}},c:{available:[{cents:1100,sources:[]}],held:{}}};
const leg=(userId,data)=>({ledgerAccount:'user_account',userId,...data});
const run=(legs,context)=>{states={...states,...transitionFunding(states,legs,context,sources,now)};};
run([leg('a',{debit:10,credit:10,availableDelta:10,heldDelta:-10})],{triggerEvent:'deposit_availability_release',walletTransactionId:'d'});
eq(fundingSummary(states.a,sources,now).available_to_play,20);
eq(fundingSummary(states.a,sources,now).available_to_withdraw,10);
fails(()=>transitionFunding(states,[leg('a',{debit:11,heldDelta:11})],{triggerEvent:'withdrawal_reservation',walletTransactionId:'w'},sources,now),/ach_withdrawal_hold/);
eq(fundingSummary(states.a,sources,now).available_to_play,20); // failed attempt cannot mutate inputs
run([leg('a',{debit:11,heldDelta:11}),leg('b',{debit:11,heldDelta:11})],{triggerEvent:'challenge_reservation',matchId:'m'});
eq(fundingSummary(states.a,sources,now).available_to_withdraw,9);
// Winner B receives full prize; A's original source restriction follows it.
run([leg('b',{creditHeld:20,heldDelta:-11}),leg('a',{heldDelta:-11})],{triggerEvent:'match_settlement',matchId:'m'});
eq(states.b.held['match:m'],[{cents:2000,sources:['d']}]);
eq(fundingSummary(states.b,sources,now).available_to_withdraw,9);
run([leg('b',{debit:20,credit:20,availableDelta:20,heldDelta:-20})],{triggerEvent:'pending_winnings_auto_release',matchId:'m'});
eq(fundingSummary(states.b,sources,now).available_to_play,29);
eq(fundingSummary(states.b,sources,now).available_to_withdraw,9);
// A second match cannot launder the hold into another player.
run([leg('b',{debit:11,heldDelta:11}),leg('c',{debit:11,heldDelta:11})],{triggerEvent:'challenge_reservation',matchId:'m2'});
run([leg('c',{creditHeld:20,heldDelta:-11}),leg('b',{heldDelta:-11})],{triggerEvent:'match_settlement',matchId:'m2'});
run([leg('c',{debit:20,credit:20,availableDelta:20,heldDelta:-20})],{triggerEvent:'pending_winnings_auto_release',matchId:'m2'});
eq(fundingSummary(states.c,sources,now).available_to_withdraw,0);
eq(fundingSummary(states.c,sources,now).available_to_play,20);
fails(()=>transitionFunding(states,[leg('c',{debit:20,heldDelta:20})],{triggerEvent:'withdrawal_reservation',walletTransactionId:'close'},sources,now),/ach_withdrawal_hold/);
// Deadline alone is insufficient. Fresh successful confirmation is required.
const after=Date.parse('2026-09-17T00:00:00Z');
eq(fundingSummary(states.c,sources,after).available_to_withdraw,0);
sources={d:{...source,deposit_withdrawal_status:'released'}};
eq(fundingSummary(states.c,sources,now).available_to_withdraw,0);
eq(fundingSummary(states.c,sources,after).available_to_withdraw,20);
eq(sourceState({...sources.d,provider_last_status:'failed'},after),'held');
sources={d:{...source,status:'reversed',deposit_hold_status:'returned'}};
eq(fundingSummary(states.c,sources,after).available_to_play,0);
fails(()=>transitionFunding(states,[leg('c',{debit:11,heldDelta:11})],{triggerEvent:'challenge_reservation',matchId:'m3'},sources,after),/ach_return_review_required/);
// A cancellation restores each player's own sources, not the other's.
sources={d:source};
let refundStates={a:{available:[],held:{'match:x':[{cents:1100,sources:['d']}]}},b:{available:[],held:{'match:x':[{cents:1100,sources:[]}]}}};
refundStates=transitionFunding(refundStates,[leg('a',{credit:11,heldDelta:-11}),leg('b',{credit:11,heldDelta:-11})],{triggerEvent:'challenge_release',matchId:'x'},sources,now);
eq(fundingSummary(refundStates.a,sources,now).available_to_withdraw,0);
eq(fundingSummary(refundStates.b,sources,now).available_to_withdraw,11);
// Held buckets prevent a deposit return from taking another match's reserve.
fails(()=>transitionFunding(refundStates,[leg('a',{heldDelta:-10})],{triggerEvent:'refund',walletTransactionId:'d'},sources,now),/funding_provenance_insufficient/);
eq(sourceState(null,now),'blocked');
eq(sourceState({...source,deposit_release_at:'invalid',deposit_withdrawal_status:'released'},after),'held');
const feeRefund=transitionFunding({a:empty()},[leg('a',{credit:1})],{triggerEvent:'service_fee_refund',matchId:'m',matchSources:['d']},sources,now);
eq(fundingSummary(feeRefund.a,sources,now).available_to_withdraw,0);
eq(fundingSummary(feeRefund.a,sources,now).available_to_play,1);
console.log('Funding provenance: '+assertions+' assertions passed.');
