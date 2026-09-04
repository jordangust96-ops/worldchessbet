import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityConfig, constantTimeEqual } from '../../shared/socureIdentity.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { encryptComplianceJson } from '../../shared/complianceEvidence.ts';
import { complianceRetentionUntil } from '../../shared/achAuthorization.js';

// Whether this webhook's body actually contains Socure's *complete* DocV
// report is a question about Socure's real payload shape for the
// Hosted Predictive DocV workflow, which is not yet provisioned
// (SOCURE_IDENTITY_ENABLED is currently false and SOCURE_IDENTITY_WORKFLOW is
// unconfirmed) -- that is intentionally NOT guessed at here. What IS fixed
// below, independent of the payload shape, is that a decision is only ever
// applied to a verification that is still open/awaiting one; see the guard
// after the event-id dedup check.
const OPEN_IDENTITY_VERIFICATION_STATES = new Set(['pending', 'review_required']);

Deno.serve(async (req) => {
  let config;
  try {
    config = identityConfig();
  } catch (err) {
    // TEMP DIAGNOSTIC (2026-09-04, remove once webhook auth is confirmed
    // working): never logs secret values, only which required field is
    // missing/invalid, to distinguish "config incomplete" from an auth
    // mismatch without exposing SOCURE_IDENTITY_* secret contents.
    console.error('socureIdentityWebhook: identityConfig() threw', { message: (err as Error)?.message });
    return new Response('Unauthorized', { status: 401 });
  }
  // identityConfig() returns { enabled: false } (rather than throwing) when
  // SOCURE_IDENTITY_ENABLED is off, with no webhookToken present. Without this
  // explicit check, the comparison below degrades to matching the literal
  // string "Bearer undefined", which is a guessable bypass. Fail closed here
  // instead of falling through to that comparison.
  if (!config.enabled) {
    // TEMP DIAGNOSTIC (2026-09-04, remove once webhook auth is confirmed working)
    console.error('socureIdentityWebhook: identity verification disabled (SOCURE_IDENTITY_ENABLED not true)');
    return new Response('Unauthorized', { status: 401 });
  }

  const authorization = req.headers.get('authorization') || '';
  if (!constantTimeEqual(authorization, `Bearer ${config.webhookToken}`)) {
    // TEMP DIAGNOSTIC (2026-09-04, remove once webhook auth is confirmed
    // working): logs only lengths and prefix/suffix shape, never the actual
    // token or header value, so a mismatch (wrong value, extra whitespace,
    // a duplicated "Bearer " prefix, etc.) is distinguishable without ever
    // exposing SOCURE_IDENTITY_WEBHOOK_TOKEN or the received header.
    console.error('socureIdentityWebhook: bearer token mismatch', {
      receivedHeaderPresent: authorization.length > 0,
      receivedHeaderLength: authorization.length,
      receivedStartsWithBearerSpace: authorization.startsWith('Bearer '),
      receivedHasDoubleBearer: authorization.startsWith('Bearer Bearer '),
      expectedHeaderLength: `Bearer ${config.webhookToken}`.length,
      configuredTokenLength: config.webhookToken.length,
      configuredTokenHasLeadingOrTrailingWhitespace: config.webhookToken !== config.webhookToken.trim(),
      configuredTokenStartsWithBearer: /^bearer\s/i.test(config.webhookToken),
    });
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const eventId = typeof body?.event_id === 'string' ? body.event_id : '';
  const eventType = typeof body?.event_type === 'string' ? body.event_type : '';
  const data = body?.data;
  if (!eventId || !data?.eval_id || !['evaluation_completed', 'decision_update'].includes(eventType)) {
    return new Response('Bad Request', { status: 400 });
  }

  const base44 = createClientFromRequest(req);
  const rows = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
    { provider_evaluation_id: data.eval_id },
    '-created_date',
    1
  );
  const verification = rows[0];
  if (!verification) return Response.json({ received: true, unmatched: true });

  const eventKey = `socure.identity.webhook:${eventId}`;
  const seen = await base44.asServiceRole.entities.IntegrationEvent.filter(
    { idempotency_key: eventKey },
    '-created_date',
    1
  );
  if (seen.length > 0 || verification.webhook_event_id === eventId) {
    return Response.json({ received: true, deduplicated: true });
  }

  // Corroborate against OUR OWN state machine (independent of the provider
  // payload's contents): a delayed, out-of-order, or replayed webhook must
  // not be able to overwrite a verification that already reached a terminal
  // outcome -- e.g. resurrecting an 'expired' row (whose session the user
  // already abandoned for a newer one) back to 'verified'. Socure's
  // documented 'decision_update' event legitimately moves 'review_required'
  // to a terminal decision, so that state stays open.
  if (!OPEN_IDENTITY_VERIFICATION_STATES.has(verification.status)) {
    await recordIntegrationEvent(base44, {
      eventType: 'identity.socure_result_ignored_terminal_state',
      aggregateType: 'user',
      aggregateId: verification.user_id,
      correlationId: verification.id,
      idempotencyKey: eventKey,
      actorType: 'system',
      userId: verification.user_id,
      status: verification.status,
      result: 'ignored_terminal_state',
      eventData: {
        provider: 'socure',
        event_type: eventType,
        verification_id: verification.id,
        evaluation_id: data.eval_id,
      },
    });
    return Response.json({ received: true, ignored: true, reason: 'verification_already_finalized' });
  }

  const decision = String(data.decision || 'UNKNOWN').toUpperCase();
  const normalizedDecision = ['ACCEPT', 'REJECT', 'REVIEW'].includes(decision) ? decision : 'UNKNOWN';
  const status =
    normalizedDecision === 'ACCEPT' ? 'verified' :
    normalizedDecision === 'REJECT' ? 'rejected' :
    normalizedDecision === 'REVIEW' ? 'review_required' : 'failed';
  const reasonCodes = (Array.isArray(data.reason_codes) ? data.reason_codes : [])
    .filter((value) => typeof value === 'string')
    .slice(0, 20);

  // A passing decision is never applied unless the full provider evidence was
  // first encrypted for the required audit-retention period. Returning 503
  // makes Socure retry rather than silently losing compliance evidence.
  let archived;
  try {
    archived = await encryptComplianceJson(body);
  } catch {
    return new Response('Evidence archive unavailable', { status: 503 });
  }
  const archivedAt = new Date().toISOString();
  const minimumRetention = complianceRetentionUntil(archivedAt);
  const retentionUntil = Date.parse(verification.retention_until || '') > Date.parse(minimumRetention)
    ? verification.retention_until
    : minimumRetention;
  const providerEventAt = Number.isFinite(Date.parse(String(body?.event_at || '')))
    ? new Date(body.event_at).toISOString()
    : archivedAt;

  await base44.asServiceRole.entities.SocureIdentityVerification.update(verification.id, {
    status,
    provider_decision: normalizedDecision,
    webhook_event_id: eventId,
    reason_codes: reasonCodes,
    completed_at: archivedAt,
    provider_event_at: providerEventAt,
    provider_report_ciphertext: archived.ciphertext,
    provider_report_iv: archived.iv,
    provider_report_sha256: archived.sha256,
    report_archived_at: archivedAt,
    retention_until: retentionUntil,
    failure_code: status === 'failed' ? 'provider_unknown_decision' : '',
  });

  // Never allow an older evaluation's callback to overwrite the user's current
  // Socure result. The immutable verification record still preserves its audit.
  const user = await base44.asServiceRole.entities.User.get(verification.user_id);
  if (user && user.identity_provider_reference === data.eval_id) {
    await base44.asServiceRole.entities.User.update(user.id, {
      identity_verification_status: status,
      identity_verification_provider: 'socure',
      identity_provider_reference: data.eval_id,
      identity_verified_at: status === 'verified' ? new Date().toISOString() : user.identity_verified_at || '',
      account_state: status === 'verified' ? 'verified' : 'provisional',
    });
  }

  await recordIntegrationEvent(base44, {
    eventType: 'identity.socure_result_received',
    aggregateType: 'user',
    aggregateId: verification.user_id,
    correlationId: verification.id,
    idempotencyKey: eventKey,
    actorType: 'system',
    userId: verification.user_id,
    status,
    result: normalizedDecision,
    eventData: {
      provider: 'socure',
      event_type: eventType,
      verification_id: verification.id,
      evaluation_id: data.eval_id,
      reason_codes: reasonCodes,
    },
  });

  return Response.json({ received: true, status });
});
