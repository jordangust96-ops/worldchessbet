import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityConfig, constantTimeEqual } from '../../shared/socureIdentity.ts';
Deno.serve(async(req)=>{
  let config; try{config=identityConfig()}catch{return new Response('Unauthorized',{status:401})}
  const auth=req.headers.get('authorization')||''; if(!constantTimeEqual(auth,'Bearer '+config.webhookToken)) return new Response('Unauthorized',{status:401});
  const body=await req.json().catch(()=>null); const data=body?.data; const eventId=String(body?.event_id||'');
  if(!body||!eventId||!data?.eval_id||!['evaluation_completed','decision_update'].includes(body.event_type)) return new Response('Bad Request',{status:400});
  const base44=createClientFromRequest(req); const rows=await base44.asServiceRole.entities.SocureIdentityVerification.filter({provider_evaluation_id:data.eval_id},'-created_date',1); const row=rows[0];
  if(!row) return Response.json({received:true,unmatched:true});
  if(row.webhook_event_id===eventId) return Response.json({received:true,deduplicated:true});
  const decision=String(data.decision||'UNKNOWN').toUpperCase(); const status=decision==='ACCEPT'?'verified':decision==='REJECT'?'rejected':decision==='REVIEW'?'review_required':'failed';
  const codes=(Array.isArray(data.reason_codes)?data.reason_codes:[]).filter((x:any)=>typeof x==='string').slice(0,20);
  await base44.asServiceRole.entities.SocureIdentityVerification.update(row.id,{status,provider_decision:['ACCEPT','REJECT','REVIEW'].includes(decision)?decision:'UNKNOWN',webhook_event_id:eventId,reason_codes:codes,completed_at:new Date().toISOString(),failure_code:status==='failed'?'provider_unknown_decision':''});
  const user=await base44.asServiceRole.entities.User.get(row.user_id);
  if(user && user.identity_provider_reference===data.eval_id) await base44.asServiceRole.entities.User.update(user.id,{identity_verification_status:status,identity_verification_provider:'socure',identity_provider_reference:data.eval_id,identity_verified_at:status==='verified'?new Date().toISOString():user.identity_verified_at||'',account_state:status==='verified'?'verified':'provisional'});
  return Response.json({received:true,status});
});