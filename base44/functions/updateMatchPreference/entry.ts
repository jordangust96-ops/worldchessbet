import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { acquireMatchLock, releaseMatchLock } from '../../shared/seamlessAtomicStore.ts';

Deno.serve(async(req)=>{
  let lockId='';const owner=crypto.randomUUID();
  try{
    if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
    const base44=createClientFromRequest(req);
    const user=await base44.auth.me().catch(()=>null);
    if(!user)return Response.json({error:'unauthorized'},{status:401});
    const {matchId,notifyOnAccept}=await req.json();
    if(typeof matchId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(matchId) || typeof notifyOnAccept!=='boolean')
      return Response.json({error:'invalid_request'},{status:400});
    const initial=await base44.asServiceRole.entities.Match.get(matchId);
    if(initial.player1_id!==user.id)return Response.json({error:'forbidden'},{status:403});
    if(!await acquireMatchLock(matchId,owner))return Response.json({error:'match_busy'},{status:409});
    lockId=matchId;
    const match=await base44.asServiceRole.entities.Match.get(matchId);
    if(match.player1_id!==user.id)return Response.json({error:'forbidden'},{status:403});
    if(match.status!=='searching' || match.challenge_in_screen_rematch)
      return Response.json({error:'match_not_searching'},{status:409});
    await base44.asServiceRole.entities.Match.update(matchId,{notify_on_accept:notifyOnAccept});
    return Response.json({matchId,notifyOnAccept});
  }catch{
    return Response.json({error:'internal_error'},{status:500});
  }finally{if(lockId)await releaseMatchLock(lockId,owner).catch(()=>{});}
});
