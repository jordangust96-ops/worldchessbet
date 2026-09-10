import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityConfig, startIdentityEvaluation, safeHostedUrl } from '../../shared/socureIdentity.ts';
import { hasVerifiedIdentity, KYC_POLICY_VERSION } from '../../shared/identityEligibility.js';
import { encryptComplianceJson } from '../../shared/kycEvidenceArchive.ts';
import { complianceRetentionUntil, requestIpAddress } from '../../shared/achAuthorization.js';
import { acquireUserWalletLock, releaseUserWalletLock } from '../../shared/seamlessAtomicStore.ts';

Deno.serve(async (req) => {
  let userId = '', owner = '', verification;
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await base44.asServiceRole.entities.User.get(caller.id);
    if (['suspended', 'closed'].includes(user.account_state) || user.withdrawal_hold)
      return Response.json({ error: 'Verification is unavailable while your account is restricted. Contact support.' }, { status: 403 });
    const config = identityConfig();
    if (!config.enabled) return Response.json({ error: 'Identity verification is temporarily unavailable.' }, { status: 503 });
    if (await hasVerifiedIdentity(base44, user)) return Response.json({ enabled: true, status: 'verified' });
    const body = await req.json().catch(() => ({}));
    if (body.consent !== true) return Response.json({ error: 'Please consent to identity and age verification.' }, { status: 400 });
    // Validate evidence encryption before starting a billable session.
    await encryptComplianceJson({ readiness: true });
    userId = user.id;
    owner = crypto.randomUUID();
    if (!await acquireUserWalletLock(userId, owner)) {
      owner = '';
      return Response.json({ error: 'Another account request is processing. Please try again shortly.' }, { status: 409 });
    }
    // The callback may have completed while this request waited for the lock.
    const lockedUser = await base44.asServiceRole.entities.User.get(user.id);
    if (['suspended', 'closed'].includes(lockedUser.account_state) || lockedUser.withdrawal_hold)
      return Response.json({ error: 'Your account is restricted. Contact support.' }, { status: 403 });
    if (await hasVerifiedIdentity(base44, lockedUser))
      return Response.json({ enabled: true, status: 'verified' });
    const latest = (await base44.asServiceRole.entities.SocureIdentityVerification.filter(
      { user_id: user.id, policy_version: KYC_POLICY_VERSION }, '-requested_at', 1
    ))[0];
    if (latest && ['rejected', 'review_required'].includes(latest.status))
      return Response.json({ error: 'Your verification needs support review. Contact hello@worldchessbet.com.', status: latest.status }, { status: 409 });
    if (latest?.status === 'pending' && Date.parse(latest.expires_at) > Date.now()) {
      const url = safeHostedUrl(latest.hosted_redirect_uri);
      return url ? Response.json({ enabled: true, status: 'pending', redirect_uri: url })
        : Response.json({ error: 'Your verification is being prepared. Please try again shortly.' }, { status: 409 });
    }
    if (latest?.status === 'pending')
      await base44.asServiceRole.entities.SocureIdentityVerification.update(latest.id, { status: 'expired', failure_code: 'session_expired' });
    const recent = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
      { user_id: user.id, requested_at: { $gte: new Date(Date.now() - 86400000).toISOString() } }, '-requested_at', 4
    );
    if (recent.length >= 3) return Response.json({ error: 'You have reached today’s verification attempt limit. Contact support for help.' }, { status: 429 });
    const now = new Date().toISOString();
    verification = await base44.asServiceRole.entities.SocureIdentityVerification.create({
      user_id: user.id, request_id: 'chessbet-identity-' + crypto.randomUUID(),
      workflow: 'consumer_onboarding', environment: 'production', policy_version: KYC_POLICY_VERSION,
      consent_version: 'socure-identity-age-2026-09-10', status: 'pending', provider_decision: 'UNKNOWN',
      requested_at: now, request_ip_address: requestIpAddress(req),
      request_user_agent: String(req.headers.get('user-agent') || '').slice(0, 1000),
      retention_until: complianceRetentionUntil(now), expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
    });
    // Bind the session before contacting Socure; a fast callback can resolve by request_id.
    await base44.asServiceRole.entities.User.update(user.id, {
      identity_verification_status: 'pending', identity_verification_provider: 'socure',
      identity_provider_reference: verification.request_id, identity_policy_version: KYC_POLICY_VERSION,
      identity_age_verified: false, identity_age_over_18: false, identity_age_over_21: false, account_state: 'provisional',
    });
    const evaluation = await startIdentityEvaluation(config, verification.request_id, user.id);
    await base44.asServiceRole.entities.SocureIdentityVerification.update(verification.id, {
      provider_evaluation_id: evaluation.eval_id, hosted_redirect_uri: evaluation.redirect_uri,
    });
    await base44.asServiceRole.entities.User.update(user.id, { identity_provider_reference: evaluation.eval_id });
    return Response.json({ enabled: true, status: 'pending', redirect_uri: evaluation.redirect_uri });
  } catch {
    // An uncertain network outcome stays pending for correlation/recovery, never accepted.
    return Response.json({ error: 'We could not start verification. Please try again shortly or contact support.' }, { status: 503 });
  } finally {
    if (owner && userId) await releaseUserWalletLock(userId, owner).catch(() => {});
  }
});

