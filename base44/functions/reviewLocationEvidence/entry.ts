import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { hasReliableLocationEvidence } from '../../shared/jurisdictionGates.js';
import { walletOnboardingLocation } from '../../shared/walletOnboardingLocation.ts';

// Admin-only evidence review. No provider calls, financial writes, or location overrides.
// repair:true only clears a current approval backed by demonstrably weak evidence.
Deno.serve(async req => {
 try {
  const base44=createClientFromRequest(req), caller=await base44.auth.me().catch(()=>null);
  if(!caller)return Response.json({error:'Unauthorized'},{status:401});
  if(caller.role!=='admin')return Response.json({error:'Forbidden'},{status:403});
  const body=await req.json().catch(()=>({}));
  if(!Array.isArray(body.userIds)||!body.userIds.length||body.userIds.length>25||
    body.userIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id)))
    return Response.json({error:'Provide 1-25 userIds'},{status:400});
  const entities=base44.asServiceRole.entities, results=[];
  for(const userId of [...new Set(body.userIds)]) {
   const user=await entities.User.get(userId);
   const logs=await entities.JurisdictionVerificationLog.filter({user_id:userId},'-verified_at',1);
   const latest=logs[0], quality=hasReliableLocationEvidence(latest);
   const location=await walletOnboardingLocation(base44,userId);
   let repaired=false;
   if(body.repair===true && user.role!=='admin' && user.jurisdiction_status==='approved' &&
      latest?.verification_result==='approved' && !quality &&
      user.jurisdiction_last_verified_at===latest.verified_at) {
    // Recheck before changing only the derived location summary.
    const fresh=await entities.User.get(userId);
    if(fresh.jurisdiction_status==='approved' && fresh.jurisdiction_last_verified_at===latest.verified_at) {
     const now=new Date().toISOString();
     await entities.JurisdictionVerificationLog.create({
      user_id:userId,provider:'PolicyReview',verification_result:'verification_failed',
      pre_bypass_verification_result:'verification_failed',geolocation_enforcement_enabled:true,
      enforcement_bypassed:false,trigger_event:'location_evidence_review',verified_at:now,
      description:'Invalidated current approval from evidence '+latest.id+
       ': insufficient location confidence, excessive accuracy radius, or conflicting signals. Historical provider record preserved; no new location asserted.'
     });
     await entities.User.update(userId,{jurisdiction_status:'verification_failed',
      current_jurisdiction_state:'',current_jurisdiction_country:'',
      jurisdiction_last_verified_at:now,jurisdiction_verification_provider:'PolicyReview'});
     repaired=true;
    }
   }
   results.push({userId,evidenceId:latest?.id,evidenceMeetsPolicy:quality,
    stateConfidence:latest?.subdivision_confidence,accuracyRadiusKm:latest?.accuracy_radius_km,
    walletLocationAllowed:location.allowed,repaired,
    currentStatus:(await entities.User.get(userId)).jurisdiction_status});
  }
  return Response.json({ok:true,results});
 } catch {return Response.json({error:'Location evidence review failed'},{status:500});}
});
