import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityWebhookConfig, readIdentityEvaluation } from '../../shared/socureIdentity.ts';
import { classifyKyc, POLICY_VERSION } from '../../shared/socureKycPolicy.js';
import { hasVerifiedIdentity } from '../../shared/identityEligibility.js';
import { encryptComplianceJson } from '../../shared/kycEvidenceArchive.ts';
import { complianceRetentionUntil } from '../../shared/achAuthorization.js';
import { acquireUserWalletLock, releaseUserWalletLock } from '../../shared/seamlessAtomicStore.ts';

// Authenticated recovery of an EXISTING evaluation. Never starts a paid evaluation,
// trusts a browser-supplied result, changes another player, or touches bank/money records.
Deno.serve(async req => {
  let userId = '', owner = '';
  try {
    if (req.method !== 'POST') return Response.json({error:'Method not allowed'}, {status:405});
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({error:'Unauthorized'}, {status:401});
    userId = caller.id;
    const initial = await base44.asServiceRole.entities.User.get(userId);
    if (await hasVerifiedIdentity(base44, initial)) return Response.json({status:'verified'});
    if (initial.identity_verification_provider !== 'socure') return Response.json({status:'not_started'});
    owner = crypto.randomUUID();
    if (!await acquireUserWalletLock(userId, owner)) {
      owner = ''; return Response.json({retry:true}, {status:409});
    }
    const current = await base44.asServiceRole.entities.User.get(userId);
    const rows = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
      {user_id:userId, policy_version:POLICY_VERSION}, '-requested_at', 1);
    let row = rows[0];
    if (!row || row.user_id !== userId || row.policy_version !== POLICY_VERSION ||
        row.workflow !== 'consumer_onboarding' || row.environment !== 'production' ||
        !row.provider_evaluation_id || current.identity_verification_provider !== 'socure' ||
        ![row.provider_evaluation_id,row.request_id].includes(current.identity_provider_reference))
      return Response.json({status:'not_started'});
    // Repair a previously persisted result if the User projection failed afterward.
    const retained = row.provider_report_source === 'socure_api' &&
      row.provider_result_reference === row.provider_evaluation_id &&
      row.provider_report_ciphertext && row.provider_report_sha256;
    if (!(retained && ['verified','rejected'].includes(row.status))) {
      if (!['pending','review_required'].includes(row.status)) return Response.json({status:row.status});
      if (Date.now() - Date.parse(row.provider_checked_at || '') < 30000)
        return Response.json({status:row.status,throttled:true});
      const checkedAt = new Date().toISOString();
      // Persist the throttle before the network call, including unavailable-provider retries.
      await base44.asServiceRole.entities.SocureIdentityVerification.update(row.id,{provider_checked_at:checkedAt});
      const data = await readIdentityEvaluation(identityWebhookConfig(),row.provider_evaluation_id);
      if (data.id !== row.request_id || data.eval_id !== row.provider_evaluation_id ||
          data.workflow !== row.workflow || data.environment_name !== 'Production')
        throw Error('Provider correlation mismatch');
      const result = classifyKyc(data);
      if (result.status === 'pending') return Response.json({status:'pending'});
      const eventAt = Date.parse(data.decision_at || data.eval_end_time || '');
      const completedAt = Date.parse(data.eval_end_time || data.decision_at || '');
      const requestedAt = Date.parse(row.requested_at || '');
      const deadline = Date.parse(row.expires_at || '');
      if (!Number.isFinite(eventAt) || !Number.isFinite(requestedAt) || !Number.isFinite(deadline) ||
          eventAt < requestedAt - 300000 || eventAt > Date.now() + 300000 ||
          !Number.isFinite(completedAt) || completedAt > deadline) throw Error('Provider result time could not be verified');
      const previousAt = Date.parse(row.provider_event_at || '');
      if (Number.isFinite(previousAt) && eventAt < previousAt) return Response.json({status:row.status});
      const archived = await encryptComplianceJson({source:'socure_api',retrieved_at:checkedAt,data});
      const patch = {
        status:result.status, provider_decision:['ACCEPT','REJECT','REVIEW'].includes(data.decision)?data.decision:'UNKNOWN',
        age_verified:result.age_verified === true, age_over_18:result.age_over_18 === true,
        age_over_21:result.age_over_21 === true, verified_legal_name:result.verified_name || '',
        failure_code:result.failure_code || '', completed_at:new Date(eventAt).toISOString(),
        provider_event_at:new Date(eventAt).toISOString(), provider_report_source:'socure_api',
        provider_result_reference:data.eval_id, provider_checked_at:checkedAt,
        provider_report_ciphertext:archived.ciphertext,provider_report_iv:archived.iv,
        provider_report_sha256:archived.sha256,report_archived_at:checkedAt,
        retention_until:complianceRetentionUntil(checkedAt),
        verified_valid_until:result.status === 'verified'?new Date(eventAt + 365*86400000).toISOString():'',
      };
      await base44.asServiceRole.entities.SocureIdentityVerification.update(row.id,patch);
      row = {...row,...patch};
    }
    const latest = await base44.asServiceRole.entities.User.get(userId);
    if (latest.identity_verification_provider !== 'socure' ||
        ![row.provider_evaluation_id,row.request_id].includes(latest.identity_provider_reference))
      return Response.json({ignored:true});
    await base44.asServiceRole.entities.User.update(userId,{
      identity_verification_provider:'socure',identity_provider_reference:row.provider_evaluation_id,
      identity_verification_status:row.status,identity_policy_version:POLICY_VERSION,
      identity_age_verified:row.age_verified === true,identity_age_over_18:row.age_over_18 === true,
      identity_age_over_21:row.age_over_21 === true,identity_legal_name:row.verified_legal_name || '',
      ...(row.status === 'verified'?{identity_verified_at:row.completed_at}:{}),
      ...(!['suspended','closed'].includes(latest.account_state)?
        {account_state:row.status === 'verified'?'verified':'provisional'}:{}),
    });
    return Response.json({status:row.status,recovered:true});
  } catch {
    return Response.json({error:'Your verification result could not be refreshed. Please try again shortly.'},{status:503});
  } finally {
    if (owner && userId) await releaseUserWalletLock(userId,owner).catch(()=>{});
  }
});
