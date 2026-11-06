import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityWebhookConfig, readIdentityEvaluation } from '../../shared/socureIdentity.ts';
import { classifyKyc, POLICY_VERSION } from '../../shared/socureKycPolicy.js';
import { encryptComplianceJson } from '../../shared/kycEvidenceArchive.ts';
import { complianceRetentionUntil } from '../../shared/achAuthorization.js';
import { acquireUserWalletLock, releaseUserWalletLock } from '../../shared/seamlessAtomicStore.ts';

async function projectIdentity(service, row, user) {
  await service.entities.User.update(user.id, {
    identity_verification_provider: 'socure', identity_provider_reference: row.provider_evaluation_id,
    identity_verification_status: row.status, identity_policy_version: POLICY_VERSION,
    identity_age_verified: row.age_verified === true, identity_age_over_18: row.age_over_18 === true,
    identity_age_over_21: row.age_over_21 === true, identity_legal_name: row.verified_legal_name || '',
    ...(row.status === 'verified' ? { identity_verified_at: row.completed_at } : {}),
    ...(!['suspended', 'closed'].includes(user.account_state)
      ? { account_state: row.status === 'verified' ? 'verified' : 'provisional' } : {}),
  });
}
async function projectWithRetryMarker(service, row, user) {
  try { await projectIdentity(service, row, user); }
  catch (error) {
    await service.entities.SocureIdentityVerification.update(row.id,
      { description: 'identity_projection_retry_pending' }).catch(() => {});
    throw error;
  }
}

// Scheduled, bounded recovery for sessions whose hosted window has elapsed.
// Only the canonical production evaluation can change identity state. This
// never creates a new evaluation, charges a player, or grants KYC from a timer.
Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const config = identityWebhookConfig(); // Works even when new starts are disabled.
    const now = new Date().toISOString();
    const service = base44.asServiceRole;
    const repairs = await service.entities.SocureIdentityVerification.filter(
      { description: 'identity_projection_retry_pending', policy_version: POLICY_VERSION,
        environment: 'production' }, 'requested_at', 50);
    const rows = await service.entities.SocureIdentityVerification.filter(
      { status: 'pending', policy_version: POLICY_VERSION, environment: 'production',
        expires_at: { $lte: now } }, 'requested_at', 50);
    const summary = { considered: rows.length, repaired: 0, expired: 0, verified: 0, rejected: 0,
      review_required: 0, still_pending: 0, superseded: 0, busy: 0, failed: 0 };
    for (const candidate of repairs) {
      let owner = '';
      try {
        owner = crypto.randomUUID();
        if (!await acquireUserWalletLock(candidate.user_id, owner)) { owner = ''; summary.busy++; continue; }
        const row = await service.entities.SocureIdentityVerification.get(candidate.id);
        const user = await service.entities.User.get(candidate.user_id);
        if (row.description !== 'identity_projection_retry_pending' ||
            !['expired', 'verified', 'rejected', 'review_required'].includes(row.status) ||
            row.policy_version !== POLICY_VERSION || row.environment !== 'production' ||
            row.workflow !== 'consumer_onboarding' || !row.provider_evaluation_id ||
            user.identity_verification_provider !== 'socure' ||
            ![row.provider_evaluation_id, row.request_id].includes(user.identity_provider_reference) ||
            (row.status !== 'expired' && (row.provider_report_source !== 'socure_api' ||
              row.provider_result_reference !== row.provider_evaluation_id ||
              !row.provider_report_ciphertext || !row.provider_report_sha256))) {
          summary.superseded++; continue;
        }
        await projectIdentity(service, row, user);
        await service.entities.SocureIdentityVerification.update(row.id,
          { description: 'Identity projection recovered' });
        summary.repaired++;
      } catch (error) {
        summary.failed++;
        console.error(JSON.stringify({ event: 'socure_projection_repair_failed',
          verification_id: candidate.id, reason: String(error?.message || 'unknown').slice(0, 100) }));
      } finally {
        if (owner) await releaseUserWalletLock(candidate.user_id, owner).catch(() => {});
      }
    }
    for (const candidate of rows) {
      const userId = candidate.user_id;
      let owner = '';
      try {
        owner = crypto.randomUUID();
        if (!await acquireUserWalletLock(userId, owner)) { owner = ''; summary.busy++; continue; }
        const row = await base44.asServiceRole.entities.SocureIdentityVerification.get(candidate.id);
        const user = await base44.asServiceRole.entities.User.get(userId);
        if (row.status !== 'pending' || row.policy_version !== POLICY_VERSION ||
            row.environment !== 'production' || row.workflow !== 'consumer_onboarding' ||
            !row.provider_evaluation_id || user.identity_verification_provider !== 'socure' ||
            ![row.provider_evaluation_id, row.request_id].includes(user.identity_provider_reference)) {
          summary.superseded++; continue;
        }
        const checkedAt = new Date().toISOString();
        const data = await readIdentityEvaluation(config, row.provider_evaluation_id);
        if (data.id !== row.request_id || data.eval_id !== row.provider_evaluation_id ||
            data.workflow !== row.workflow || data.environment_name !== 'Production')
          throw Error('provider_correlation_mismatch');
        const result = classifyKyc(data);
        if (result.status === 'pending') {
          // Time alone does not prove abandonment. Socure must still show the
          // paused hosted flow before a retry is offered.
          const paused = data.eval_status === 'evaluation_paused' &&
            (!data.evaluation_status || data.evaluation_status === 'evaluation_paused');
          if (!paused) {
            await base44.asServiceRole.entities.SocureIdentityVerification.update(row.id,
              { provider_checked_at: checkedAt });
            summary.still_pending++; continue;
          }
          const expired = { ...row, status: 'expired', provider_checked_at: checkedAt,
            failure_code: 'hosted_verification_incomplete_expired',
            description: 'Provider confirmed hosted verification remained incomplete after session expiry' };
          await service.entities.SocureIdentityVerification.update(row.id,
            { status: expired.status, provider_checked_at: expired.provider_checked_at,
              failure_code: expired.failure_code, description: expired.description });
          await projectWithRetryMarker(service, expired, user);
          summary.expired++; continue;
        }
        const eventAt = Date.parse(data.decision_at || data.eval_end_time || '');
        const completedAt = Date.parse(data.eval_end_time || data.decision_at || '');
        const requestedAt = Date.parse(row.requested_at || '');
        const deadline = Date.parse(row.expires_at || '');
        if (!Number.isFinite(eventAt) || !Number.isFinite(completedAt) ||
            !Number.isFinite(requestedAt) || !Number.isFinite(deadline) ||
            eventAt < requestedAt - 300000 || eventAt > Date.now() + 300000)
          throw Error('provider_result_time_unverifiable');
        const late = completedAt > deadline;
        const status = late ? 'review_required' : result.status;
        const archived = await encryptComplianceJson(
          { source: 'socure_api', retrieved_at: checkedAt, data }, { compress: true });
        const patch = {
          status, provider_decision: ['ACCEPT', 'REJECT', 'REVIEW'].includes(data.decision)
            ? data.decision : 'UNKNOWN',
          age_verified: !late && result.age_verified === true,
          age_over_18: !late && result.age_over_18 === true,
          age_over_21: !late && result.age_over_21 === true,
          verified_legal_name: late ? '' : result.verified_name || '',
          failure_code: late ? 'late_provider_result_requires_review' : result.failure_code || '',
          completed_at: new Date(eventAt).toISOString(), provider_event_at: new Date(eventAt).toISOString(),
          provider_checked_at: checkedAt, provider_report_source: 'socure_api',
          provider_result_reference: data.eval_id,
          provider_report_ciphertext: archived.ciphertext, provider_report_iv: archived.iv,
          provider_report_sha256: archived.sha256, report_archived_at: checkedAt,
          retention_until: complianceRetentionUntil(checkedAt),
          verified_valid_until: status === 'verified'
            ? new Date(eventAt + 365 * 86400000).toISOString() : '',
          description: late ? 'Late provider completion requires support review'
            : 'Canonical provider result synchronized by overdue-session recovery',
        };
        await service.entities.SocureIdentityVerification.update(row.id, patch);
        await projectWithRetryMarker(service, { ...row, ...patch }, user);
        summary[status]++;
      } catch (error) {
        summary.failed++;
        console.error(JSON.stringify({ event: 'socure_overdue_reconciliation_failed',
          verification_id: candidate.id, reason: String(error?.message || 'unknown').slice(0, 100) }));
      } finally {
        if (owner) await releaseUserWalletLock(userId, owner).catch(() => {});
      }
    }
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    console.error(JSON.stringify({ event: 'socure_overdue_sweep_failed',
      reason: String(error?.message || 'unknown').slice(0, 100) }));
    return Response.json({ error: 'Socure reconciliation unavailable' }, { status: 503 });
  }
});