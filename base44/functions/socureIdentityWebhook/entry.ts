import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityConfig, constantTimeEqual } from '../../shared/socureIdentity.ts';
import { encryptComplianceJson } from '../../shared/kycEvidenceArchive.ts';
import { classifyKyc, POLICY_VERSION } from '../../shared/socureKycPolicy.js';
import { complianceRetentionUntil } from '../../shared/achAuthorization.js';
import { acquireUserWalletLock, releaseUserWalletLock } from '../../shared/seamlessAtomicStore.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

Deno.serve(async (req) => {
  let owner = '', userId = '';
  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let config;
    try { config = identityConfig(); } catch { return new Response('Unavailable', { status: 503 }); }
    if (!config.enabled || !config.webhookToken ||
        !constantTimeEqual(req.headers.get('authorization') || '', 'Bearer ' + config.webhookToken))
      return new Response('Unauthorized', { status: 401 });
    const raw = await req.text();
    if (raw.length > 2000000) return new Response('Payload too large', { status: 413 });
    let body; try { body = JSON.parse(raw); } catch { return new Response('Invalid JSON', { status: 400 }); }
    const data = body?.data, eventId = body?.event_id;
    if (!['evaluation_completed', 'reevaluation', 'decision_update', 'workflow_execution_failed'].includes(body?.event_type))
      return Response.json({ received: true, ignored: true });
    // A separate bank-screening webhook previously used this URL. It must never grant KYC.
    if (data?.workflow && data.workflow !== 'consumer_onboarding') return Response.json({ received: true, ignored: true });
    if (typeof eventId !== 'string' || !eventId || typeof data?.eval_id !== 'string' || !data.eval_id)
      return new Response('Invalid event', { status: 400 });
    const eventAt = Date.parse(body.event_at || '');
    if (!Number.isFinite(eventAt) || eventAt > Date.now() + 300000) return new Response('Invalid event time', { status: 400 });
    const base44 = createClientFromRequest(req);
    let rows = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
      { provider_evaluation_id: data.eval_id }, '-requested_at', 1
    );
    if (!rows.length && typeof data.id === 'string') rows = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
      { request_id: data.id }, '-requested_at', 1
    );
    let verification = rows[0];
    if (!verification || verification.policy_version !== POLICY_VERSION) return Response.json({ received: true, unmatched: true });
    if (data.id && data.id !== verification.request_id) return new Response('Correlation mismatch', { status: 400 });
    if (verification.provider_evaluation_id && verification.provider_evaluation_id !== data.eval_id)
      return new Response('Correlation mismatch', { status: 400 });
    userId = verification.user_id;
    owner = crypto.randomUUID();
    if (!await acquireUserWalletLock(userId, owner)) { owner = ''; return new Response('Retry later', { status: 503 }); }
    verification = await base44.asServiceRole.entities.SocureIdentityVerification.get(verification.id);
    const user = await base44.asServiceRole.entities.User.get(userId);
    if (user.identity_verification_provider !== 'socure' ||
        ![data.eval_id, verification.request_id].includes(user.identity_provider_reference))
      return Response.json({ received: true, ignored: true, reason: 'superseded_session' });
    const previousTime = Date.parse(verification.provider_event_at || '');
    const duplicate = verification.webhook_event_id === eventId;
    if (!duplicate && Number.isFinite(previousTime) && eventAt <= previousTime)
      return Response.json({ received: true, ignored: true, reason: 'older_event' });
    if (verification.status === 'expired') return Response.json({ received: true, ignored: true, reason: 'expired_session' });
    if (!duplicate) {
      const result = body.event_type === 'workflow_execution_failed'
        ? { status: 'failed', age_verified: false, failure_code: 'provider_execution_failed' }
        : classifyKyc(data);
      // ACCEPT alone, absent verified DOB evidence, remains review_required.
      const archived = await encryptComplianceJson(body);
      const now = new Date().toISOString();
      const updated = {
        status: result.status, age_verified: result.age_verified,
        age_over_18: result.age_over_18 === true, age_over_21: result.age_over_21 === true,
        provider_decision: ['ACCEPT', 'REJECT', 'REVIEW'].includes(data.decision) ? data.decision : 'UNKNOWN',
        provider_evaluation_id: data.eval_id, webhook_event_id: eventId,
        failure_code: result.failure_code, completed_at: now, provider_event_at: new Date(eventAt).toISOString(),
        provider_report_ciphertext: archived.ciphertext, provider_report_iv: archived.iv,
        provider_report_sha256: archived.sha256, report_archived_at: now,
        retention_until: complianceRetentionUntil(now),
        verified_valid_until: result.status === 'verified' ? new Date(Date.now() + 365 * 86400000).toISOString() : '',
      };
      await base44.asServiceRole.entities.SocureIdentityVerification.update(verification.id, updated);
      verification = { ...verification, ...updated };
    }
    // Retry this projection even on duplicate delivery: a prior attempt may have saved
    // the evidence but failed before updating User. Restrictions are always preserved.
    const current = await base44.asServiceRole.entities.User.get(userId);
    if (![data.eval_id, verification.request_id].includes(current.identity_provider_reference))
      return Response.json({ received: true, ignored: true });
    await base44.asServiceRole.entities.User.update(userId, {
      identity_verification_provider: 'socure', identity_provider_reference: data.eval_id,
      identity_verification_status: verification.status, identity_policy_version: POLICY_VERSION,
      identity_age_verified: verification.age_verified === true,
      identity_age_over_18: verification.age_over_18 === true, identity_age_over_21: verification.age_over_21 === true,
      identity_verified_at: verification.status === 'verified' ? verification.completed_at : '',
      ...(!['suspended', 'closed'].includes(current.account_state)
        ? { account_state: verification.status === 'verified' ? 'verified' : 'provisional' } : {}),
    });
    await recordIntegrationEvent(base44, {
      eventType: 'identity.socure_result_received', aggregateType: 'user', aggregateId: userId,
      correlationId: verification.id, idempotencyKey: 'socure.identity.webhook:' + eventId,
      actorType: 'system', userId, status: verification.status, result: verification.provider_decision,
      eventData: { provider: 'socure', verification_id: verification.id, evaluation_id: data.eval_id, failure_code: verification.failure_code || '' },
    });
    return Response.json({ received: true, status: verification.status, deduplicated: duplicate });
  } catch {
    return new Response('Verification update unavailable; retry delivery', { status: 503 });
  } finally {
    if (owner && userId) await releaseUserWalletLock(userId, owner).catch(() => {});
  }
});

