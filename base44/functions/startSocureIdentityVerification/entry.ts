import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityConfig, startIdentityEvaluation } from '../../shared/socureIdentity.ts';

const SESSION_TTL_MS = 30 * 60 * 1000;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let verification;
  try {
    const config = identityConfig();
    if (!config.enabled) {
      return Response.json({ enabled: false, reason: 'Identity verification is not enabled.' });
    }

    if (
      user.identity_verification_status === 'verified' &&
      user.identity_verification_provider === 'socure' &&
      user.identity_provider_reference
    ) {
      return Response.json({ enabled: true, status: 'verified' });
    }

    const now = Date.now();
    const pending = (
      await base44.asServiceRole.entities.SocureIdentityVerification.filter(
        { user_id: user.id, status: 'pending' },
        '-created_date',
        1
      )
    )[0];
    const expiresAtMs = Date.parse(pending?.expires_at || '');
    if (pending && Number.isFinite(expiresAtMs) && expiresAtMs > now && pending.hosted_redirect_uri) {
      return Response.json({ enabled: true, status: 'pending', redirect_uri: pending.hosted_redirect_uri });
    }
    if (pending) {
      await base44.asServiceRole.entities.SocureIdentityVerification.update(pending.id, {
        status: 'expired',
        failure_code: 'session_expired',
        completed_at: new Date().toISOString(),
      });
    }

    const requestedAt = new Date();
    verification = await base44.asServiceRole.entities.SocureIdentityVerification.create({
      user_id: user.id,
      request_id: `chessbet-identity-${crypto.randomUUID()}`,
      workflow: config.workflow,
      status: 'pending',
      provider_decision: 'UNKNOWN',
      requested_at: requestedAt.toISOString(),
      expires_at: new Date(requestedAt.getTime() + SESSION_TTL_MS).toISOString(),
    });

    const evaluation = await startIdentityEvaluation(config, verification.request_id);
    await base44.asServiceRole.entities.SocureIdentityVerification.update(verification.id, {
      provider_evaluation_id: evaluation.eval_id,
      hosted_redirect_uri: evaluation.redirect_uri,
    });
    await base44.asServiceRole.entities.User.update(user.id, {
      identity_verification_status: 'pending',
      identity_verification_provider: 'socure',
      identity_provider_reference: evaluation.eval_id,
    });
    return Response.json({ enabled: true, status: 'pending', redirect_uri: evaluation.redirect_uri });
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
