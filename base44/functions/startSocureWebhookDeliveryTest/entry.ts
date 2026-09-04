import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityConfig, startIdentityEvaluation } from '../../shared/socureIdentity.ts';
import { legalNameFromUser } from '../../shared/legalName.ts';
import { complianceRetentionUntil, requestIpAddress } from '../../shared/achAuthorization.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const CONFIRMATION = 'SOCURE_WEBHOOK_DELIVERY_TEST';

// Admin-only, controlled production re-verification. It deliberately creates a
// separate verification record and never changes the user's existing verified
// eligibility. Its only purpose is to prove an actual Socure completion reaches
// the production callback and persists encrypted evidence end-to-end.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body?.confirmation !== CONFIRMATION) {
    return Response.json({ error: 'explicit_confirmation_required' }, { status: 400 });
  }
  if (!legalNameFromUser(user)) return Response.json({ error: 'legal_name_required' }, { status: 409 });

  let verification: any;
  try {
    const config = identityConfig();
    if (!config.enabled) return Response.json({ enabled: false, reason: 'Identity verification is not enabled.' });

    const requestedAt = new Date();
    verification = await base44.asServiceRole.entities.SocureIdentityVerification.create({
      user_id: user.id,
      request_id: `chessbet-socure-webhook-test-${crypto.randomUUID()}`,
      workflow: config.workflow,
      status: 'pending',
      provider_decision: 'UNKNOWN',
      requested_at: requestedAt.toISOString(),
      request_ip_address: requestIpAddress(req),
      request_user_agent: String(req.headers.get('user-agent') || '').slice(0, 1000),
      retention_until: complianceRetentionUntil(requestedAt.toISOString()),
      expires_at: new Date(requestedAt.getTime() + SESSION_TTL_MS).toISOString(),
      description: 'Controlled production Socure webhook-delivery verification. This record does not change the user eligibility snapshot.',
    });

    const evaluation = await startIdentityEvaluation(config, verification.request_id);
    await base44.asServiceRole.entities.SocureIdentityVerification.update(verification.id, {
      provider_evaluation_id: evaluation.eval_id,
      hosted_redirect_uri: evaluation.redirect_uri,
    });
    return Response.json({
      enabled: true,
      status: 'pending',
      verification_id: verification.id,
      evaluation_id: evaluation.eval_id,
      redirect_uri: evaluation.redirect_uri,
    });
  } catch {
    if (verification?.id) {
      await base44.asServiceRole.entities.SocureIdentityVerification.update(verification.id, {
        status: 'failed',
        failure_code: 'provider_start_failed',
        completed_at: new Date().toISOString(),
      });
    }
    return Response.json({ error: 'identity_verification_unavailable' }, { status: 503 });
  }
});
