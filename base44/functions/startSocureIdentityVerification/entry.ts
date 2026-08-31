import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';
import { identityConfig, startIdentityEvaluation } from '../../shared/socureIdentity.ts';
Deno.serve(async (req) => {
  const base44=createClientFromRequest(req); const user=await base44.auth.me();
  if(!user) return Response.json({error:'Unauthorized'},{status:401});
  if(EARLY_ACCESS_MODE) return Response.json({enabled:false,reason:'Identity verification is unavailable during Early Access.'});
  try {
    const config=identityConfig(); if(!config.enabled) return Response.json({enabled:false,reason:'Identity verification is not enabled.'});
    const existing=(await base44.asServiceRole.entities.SocureIdentityVerification.filter({user_id:user.id,status:'pending'},'-created_date',1))[0];
    if(existing?.hosted_redirect_uri) return Response.json({enabled:true,status:'pending',redirect_uri:existing.hosted_redirect_uri});
    const requestId='chessbet-identity-'+crypto.randomUUID();
    const row=await base44.asServiceRole.entities.SocureIdentityVerification.create({user_id:user.id,request_id:requestId,workflow:config.workflow,status:'pending',provider_decision:'UNKNOWN',requested_at:new Date().toISOString()});
    const evaluation=await startIdentityEvaluation(config,requestId);
    await base44.asServiceRole.entities.SocureIdentityVerification.update(row.id,{provider_evaluation_id:evaluation.eval_id,hosted_redirect_uri:evaluation.redirect_uri});
    await base44.asServiceRole.entities.User.update(user.id,{identity_verification_status:'pending',identity_verification_provider:'socure',identity_provider_reference:evaluation.eval_id});
    return Response.json({enabled:true,status:'pending',redirect_uri:evaluation.redirect_uri});
  } catch { return Response.json({error:'identity_verification_unavailable'},{status:503}); }
});