import { acquireMatchLock, releaseMatchLock, refreshContestLocks } from './seamlessAtomicStore.ts';
import { fail } from './challengeAccess.ts';
import { createChallenge, acceptChallenge, cancelChallenge, recoverChallenge } from './challengeLifecycle.ts';
import { CHALLENGE_CREATION_VERSION, isFreeMatch, challengeExpired } from './challengePolicy.js';
import { rematchRole, rematchPresent, requireRematchPresence, REMATCH_PRESENCE_MS, REMATCH_OFFER_MS } from './rematchPresence.ts';

async function locked(id: string, work: any) {
  const owner=crypto.randomUUID();
  if (!await acquireMatchLock(id,owner)) fail('busy','The rematch is updating. Please try again.',409);
  let lost=false;
  const check=async()=>{if(lost || !await refreshContestLocks(id,[],owner)){lost=true;fail('busy','Please retry the rematch.',409);}};
  const timer=setInterval(()=>{check().catch(()=>{lost=true;});},10000);
  try {await check();return await work(check);}
  finally {clearInterval(timer);await releaseMatchLock(id,owner).catch(()=>{});}
}
export async function rematchControl(req: Request, base44: any, user: any, body: any) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(body.matchId||'')) ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(String(body.screenId||'')))
    fail('invalid_rematch','Return to the match result screen.',400);
  const entities=base44.asServiceRole.entities;
  let parent=await entities.Match.get(body.matchId);
  const role=rematchRole(parent,user.id);
  if (!role || parent.status!=='completed' || Number(parent.launch_epoch)!==2 || !parent.player2_id)
    fail('invalid_rematch','Rematches are only available to the two players after their game ends.',403);
  const action=body.action, field='post_match_'+role+'_presence';
  if (['rematch_enter','rematch_poll','rematch_leave'].includes(action)) {
    await locked('rematch-presence:'+parent.id+':'+user.id,async check=>{
      const current=await entities.Match.get(parent.id),p=current[field];
      if(action!=='rematch_enter' && (p?.token!==body.screenId || p?.left)) return;
      await check();
      await entities.Match.update(parent.id,{[field]:{token:body.screenId,left:action==='rematch_leave',
        until:action==='rematch_leave'?0:Date.now()+REMATCH_PRESENCE_MS}});
    });
  }
  return locked('rematch-offer:'+parent.id,async check=>{
    parent=await entities.Match.get(parent.id);
    const opponentId=parent.player1_id===user.id?parent.player2_id:parent.player1_id;
    const free=isFreeMatch(parent);
    const terms={playMode:free?'free':'money',entryAmount:free?0:Number(parent.wager_amount),
      serviceFee:free?0:Number(parent.platform_service_fee),timeControl:parent.time_control};
    let child=(await entities.Match.filter({challenge_rematch_of:parent.id,challenge_in_screen_rematch:true},'-created_date',1))[0];
    const accepted=()=>child && ['preparing','both_ready','in_progress','completed'].includes(child.status);
    const close=async(reason='cancelled')=>{
      await check();
      await cancelChallenge(base44,{id:child.player1_id},child.id,reason);
      child=await entities.Match.get(child.id);
    };
    if(child && ['reserving','releasing'].includes(child.challenge_operation_state)) {
      await recoverChallenge(base44,child.id);
      child=await entities.Match.get(child.id);
    }
    if(child?.status==='searching' && !['reserving','releasing'].includes(child.challenge_operation_state)) {
      let available=!challengeExpired(child);
      try {await requireRematchPresence(base44,child);}catch(error){if(error?.code!=='opponent_left')throw error;available=false;}
      if(!available)await close();
    }
    const snapshot=()=>({
      opponentPresent:rematchPresent(parent,opponentId),selfPresent:rematchPresent(parent,user.id,body.screenId),
      terms, offer:child?{id:child.id,status:accepted()?'accepted':child.status==='searching'?
        (['reserving','releasing'].includes(child.challenge_operation_state)?'processing':'pending'):
        child.status==='cancelled'?(child.challenge_close_reason==='declined'?'declined':'closed'):'processing',
        incoming:child.player1_id!==user.id,expiresAt:child.challenge_expires_at,
        entryAmount:child.wager_amount,serviceFee:child.platform_service_fee,
        ...(accepted()?{matchId:child.id}:{})}:null
    });
    if(['rematch_enter','rematch_poll','rematch_leave'].includes(action))return snapshot();
    if(!rematchPresent(parent,user.id,body.screenId)) fail('screen_left','Return to this game’s result screen to rematch.',409);
    if(action==='rematch_decline' || action==='rematch_cancel') {
      if(!child || child.id!==body.offerId)fail('offer_changed','This rematch offer has changed.',409);
      if(accepted())return snapshot();
      if(action==='rematch_decline' && child.player1_id===user.id)fail('own_offer','Cancel your own rematch offer.',400);
      if(action==='rematch_cancel' && child.player1_id!==user.id)fail('different_opponent','Decline the opponent’s offer instead.',400);
      await close(action==='rematch_decline'?'declined':'cancelled');return snapshot();
    }
    if(action==='rematch_request' && child?.status==='cancelled' && child.challenge_close_reason==='declined')return snapshot();
    if(!rematchPresent(parent,opponentId))fail('opponent_left','Your opponent has left the result screen.',409);
    if(action==='rematch_request') {
      // Crossing requests show the existing incoming offer, never reserve twice.
      if(child && (accepted() || child.status!=='cancelled'))return snapshot();
      if(Number(body.entryAmount)!==terms.entryAmount || Number(body.serviceFee)!==terms.serviceFee)
        fail('terms_changed','Review the rematch entry and fee again.',409);
      const presence={creator:body.screenId,opponent:parent['post_match_'+rematchRole(parent,opponentId)+'_presence'].token};
      const result=await createChallenge(base44,user,{...terms,creationVersion:CHALLENGE_CREATION_VERSION,
        requestKey:body.requestKey,rematchOf:parent.id,publiclyListed:false},req,
        {presence,serviceFee:terms.serviceFee,feeScheduleVersion:parent.platform_fee_schedule_version,
          clockMs:parent.clock_initial_ms,displayName:parent.display_name,
          expiresAt:new Date(Date.now()+REMATCH_OFFER_MS).toISOString(),check});
      child=result.match;
      try{await requireRematchPresence(base44,child);}catch(error){if(error?.code!=='opponent_left')throw error;await close();}
      return snapshot();
    }
    if(action==='rematch_accept') {
      if(!child || child.id!==body.offerId)fail('offer_changed','This rematch offer is no longer available.',409);
      if(child.player1_id===user.id)fail('own_offer','Wait for your opponent to accept.',400);
      if(accepted())return snapshot();
      await requireRematchPresence(base44,child);await check();
      await acceptChallenge(req,base44,user,child,body,{check});
      child=await entities.Match.get(child.id);
      return snapshot();
    }
    fail('invalid_action','Unknown rematch action.',400);
  });
}
