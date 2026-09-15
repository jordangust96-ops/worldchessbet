import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as display from '../src/lib/matchDisplayState.js';
import {fixture} from './free-play-test-fixture.mjs';
// Execute the real MatchView render with inert hooks and leaf components.
const React={createElement:(type,props,...children)=>({type,props,children}),useState:v=>[v,()=>{}],useEffect:()=>{},useRef:v=>({current:v})};
const mod={exports:{}};
const require=name=>name==='react'?React:name.endsWith('matchDisplayState')?display:name.endsWith('use-toast')?{useToast:()=>({toast:()=>{}})}:new Proxy({}, {get:(_,key)=>key==='__esModule'?true:key==='default'?name.split('/').at(-1):key});
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/play/MatchView.jsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,{module:mod,exports:mod.exports,require});
const view=(match,game)=>mod.exports.default({matchId:match.id,match,game,userId:'p1'});
const contains=(tree,type)=>tree && (tree.type===type || tree.children?.flat().some(child=>contains(child,type)));
for(const free of [true,false]) {
 const f=fixture();
 const parent={id:'finished',launch_epoch:2,status:'completed',player1_id:'p1',player2_id:'p2',play_mode:free?'free':'money',wager_amount:free?0:25,platform_service_fee:free?0:2,time_control:'blitz'};
 f.table('Match').push(parent);
 const control=f.load('base44/shared/rematchControl.ts').exports.rematchControl;
 const call=(id,action,extra={})=>control(f.request,f.sdk,f.user(id),{matchId:parent.id,screenId:'screen_session_for_'+id,action:'rematch_'+action,entryAmount:parent.wager_amount,serviceFee:parent.platform_service_fee,agree:true,requestKey:'rematch_request_123456',...extra});
 await call('p1','enter');await call('p2','enter');
 const offer=await call('p1','request');await call('p2','decline',{offerId:offer.offer.id});
 assert.equal((await call('p1','poll')).offer.status,'closed');
 assert.equal(f.get(parent.id).status,'completed');
 assert.equal(f.get(offer.offer.id).status,'cancelled');
 const game={id:'old-game',match_id:parent.id,status:'completed'};
 for(const update of [{id:parent.id,post_match_player2_presence:{left:false}},{...parent,status:'in_progress'},{...parent,status:'settling'}]) {
  const merged=display.mergeMatchDisplay(parent,update);
  assert.equal(merged.status,'completed');assert.ok(contains(view(merged,game),'SettlementState'));
  assert.equal(display.isMatchFinalizing(merged,game),false);
 }
 const next={...parent,id:'next',status:'preparing',challenge_version:1};
 assert.ok(contains(view(next,game),'ChallengeReadyScreen'));
 assert.equal(display.isMatchFinalizing(next,game),false);
 const live={...next,status:'in_progress'};
 assert.ok(contains(view(live,game),'MatchStartCountdown'));
 assert.ok(contains(view(live,{...game,match_id:'next'}),'FinalizingMatch'));
 assert.equal(f.table('Wallet')[0].available_balance,100);
 console.log('PASS '+(free?'free':'money')+' decline keeps result; stale updates and previous game cannot reopen finalizing; real settlement still waits');
}
const fresh={id:'x',status:'in_progress',updated_date:'2026-09-14T12:01:00Z'};
assert.equal(display.mergeMatchDisplay(fresh,{id:'x',status:'preparing',updated_date:'2026-09-14T12:00:00Z'}),fresh);
assert.equal(display.mergeMatchDisplay(fresh,null),null);
console.log('PASS old snapshots rejected and explicit exit preserved');
