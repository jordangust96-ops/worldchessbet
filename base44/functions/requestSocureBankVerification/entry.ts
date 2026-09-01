import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import {
  SOCURE_PROVIDER_KEY,
  evaluateSocureBankAccount,
  sha256Hex,
  socureConfig,
} from '../../shared/socure.ts';

// Authenticated users initiate Account Intelligence only for their own verified
// Seamless funding source. Raw routing/account input exists only for this
// in-memory request: it is never returned, logged, or persisted.
const DIGITS = /^[0-9]+$/;

function splitLegalName(user: any) {
  const fullName = String(user?.full_name || user?.name || '').trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { givenName: parts[0], familyName: parts.slice(1).join(' ') };
}

function extractSignals(response: any) {
  const enrichments = Array.isArray(response?.data_enrichments) ? response.data_enrichments : [];
  const source = enrichments.find((entry: any) =>
    entry?.response?.accountIntelligence || entry?.response?.account_intelligence
  );
  const signals = source?.response?.accountIntelligence || source?.response?.account_intelligence || {};
  const decision = ['ACCEPT', 'REVIEW', 'REJECT'].includes(String(response?.decision))
    ? String(response.decision)
    : 'UNKNOWN';
  const accountStatus = ['OPEN', 'CLOSED', 'PENDING', 'INVALID'].includes(String(signals?.accountStatus))
    ? String(signals.accountStatus)
    : 'UNKNOWN';
  const reasonCodes = Array.isArray(signals?.reasonCodes)
    ? signals.reasonCodes.filter((item: unknown) => typeof item === 'string').slice(0, 20)
    : [];
  return {
    decision,
    accountStatus,
    availabilityScore: typeof signals?.availabilityScore === 'number' ? signals.availabilityScore : undefined,
    ownershipScore: typeof signals?.ownershipScore === 'number' ? signals.ownershipScore : undefined,
    reasonCodes,
    evaluationId: typeof response?.eval_id === 'string' ? response.eval_id : '',
    referenceId: typeof signals?.referenceId === 'string' ? signals.referenceId : '',
  };
}

function publicVerification(verification: any) {
  if (!verification) return null;
  return {
    id: verification.id,
    source_id: verification.source_id,
    status: verification.status,
    decision: verification.decision,
    requested_at: verification.requested_at,
    completed_at: verification.completed_at,
  };
}

function firstByCreated(records: any[]) {
  return [...records].sort((a, b) =>
    new Date(a?.created_date || 0).getTime() - new Date(b?.created_date || 0).getTime()
    || String(a?.id || '').localeCompare(String(b?.id || ''))
  )[0] || null;
}

Deno.serve(async (req) => {
  let base44: any;
  let candidate: any = null;
  let user: any = null;
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();

    // No Socure network request is possible while the separate server-only
    // switch is unset or false.
    const config = socureConfig();
    if (!config.enabled) {
      return Response.json({ enabled: false, reason: 'Socure screening is not enabled.' });
    }

    const { sourceId, accountNumber, routingNumber } = body || {};
    const normalizedAccount = typeof accountNumber === 'string' ? accountNumber.replace(/\s+/g, '') : '';
    const normalizedRouting = typeof routingNumber === 'string' ? routingNumber.replace(/\s+/g, '') : '';
    if (
      typeof sourceId !== 'string' || !sourceId ||
      !DIGITS.test(normalizedAccount) || normalizedAccount.length < 4 || normalizedAccount.length > 34 ||
      !/^\d{9}$/.test(normalizedRouting)
    ) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const bank = await base44.asServiceRole.entities.SeamlessBankAccount.filter({
        user_id: user.id,
        source_id: sourceId,
        status: 'verified',
      });
    if (user.account_state !== 'verified' || user.withdrawal_hold ||
        user.identity_verification_status !== 'verified' ||
        user.identity_verification_provider !== 'socure' || !user.identity_provider_reference) {
      return Response.json({ error: 'target_not_eligible' }, { status: 403 });
    }
    const fundingSource = bank[0];
    // The hosted provider must independently confirm the provided account's
    // final four. Without that binding, Socure cannot be justified here.
    const mask = String(fundingSource?.account_mask || '').replace(/\D/g, '');
    if (!fundingSource || mask.length < 4 || !normalizedAccount.endsWith(mask)) {
      return Response.json({ error: 'funding_source_account_mismatch' }, { status: 409 });
    }
    const legalName = splitLegalName(user);
    if (!legalName) {
      return Response.json({ error: 'verified_legal_name_required' }, { status: 409 });
    }

    const fingerprint = await sha256Hex(`${normalizedRouting}:${normalizedAccount}`);
    const requestKey = `socure:bank:v1:${sourceId}:${fingerprint}`;
    const existing = await base44.asServiceRole.entities.SocureBankVerification.filter({ request_key: requestKey });
    if (existing.length > 0) {
      return Response.json({ enabled: true, charged: false, already_requested: true, verification: publicVerification(firstByCreated(existing)) });
    }

    // Durable, deterministic request marker before the paid API boundary.
    candidate = await base44.asServiceRole.entities.SocureBankVerification.create({
      user_id: user.id,
      source_id: sourceId,
      request_key: requestKey,
      account_fingerprint: fingerprint,
      workflow: config.workflow,
      status: 'processing',
      decision: 'UNKNOWN',
      requested_by_user_id: user.id,
      requested_at: new Date().toISOString(),
    });

    // Election prevents concurrent requests for the same source/account from
    // producing duplicate paid evaluations. A stale/unknown record is never
    // retried automatically; it remains for human review.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const candidates = await base44.asServiceRole.entities.SocureBankVerification.filter({ request_key: requestKey });
    const canonical = firstByCreated(candidates);
    if (!canonical || canonical.id !== candidate.id) {
      await base44.asServiceRole.entities.SocureBankVerification.update(candidate.id, {
        status: 'duplicate_suppressed',
        completed_at: new Date().toISOString(),
        error_code: 'duplicate_suppressed',
      });
      return Response.json({ enabled: true, charged: false, already_requested: true, verification: publicVerification(canonical) });
    }

    const response = await evaluateSocureBankAccount({
      config,
      evaluationId: `chessbet-${candidate.id}`,
      givenName: legalName.givenName,
      familyName: legalName.familyName,
      accountNumber: normalizedAccount,
      routingNumber: normalizedRouting,
    });
    const signals = extractSignals(response);
    const status = signals.decision === 'ACCEPT' ? 'completed' : 'manual_review_required';
    const completed = await base44.asServiceRole.entities.SocureBankVerification.update(candidate.id, {
      status,
      decision: signals.decision,
      evaluation_id: signals.evaluationId,
      reference_id: signals.referenceId,
      availability_score: signals.availabilityScore,
      ownership_score: signals.ownershipScore,
      account_status: signals.accountStatus,
      reason_codes: signals.reasonCodes,
      completed_at: new Date().toISOString(),
      error_code: '',
    });

    await recordIntegrationEvent(base44, {
      eventType: 'compliance.socure_bank_verification_completed',
      aggregateType: 'user',
      aggregateId: user.id,
      correlationId: candidate.id,
      idempotencyKey: `socure:bank:completed:${candidate.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      status,
      result: signals.decision,
      eventData: {
        provider: SOCURE_PROVIDER_KEY,
        verification_id: candidate.id,
        source_id: sourceId,
        account_status: signals.accountStatus,
      },
    });

    return Response.json({
      enabled: true,
      charged: true,
      verification: publicVerification(completed),
      human_review_required: status === 'manual_review_required',
    });
  } catch (error) {
    const category = String((error as any)?.socureCategory || 'internal_error').slice(0, 128);
    const unknownOutcome = category.includes('unknown_outcome');
    if (base44 && candidate) {
      try {
        const status = unknownOutcome ? 'unknown_outcome' : 'failed';
        const updated = await base44.asServiceRole.entities.SocureBankVerification.update(candidate.id, {
          status,
          completed_at: new Date().toISOString(),
          error_code: category,
        });
        await recordIntegrationEvent(base44, {
          eventType: 'compliance.socure_bank_verification_unresolved',
          aggregateType: 'user',
          aggregateId: updated.user_id,
          correlationId: updated.id,
          idempotencyKey: `socure:bank:unresolved:${updated.id}`,
          actorType: 'user',
          actorId: user?.id || '',
          userId: updated.user_id,
          status,
          result: category,
          eventData: {
            provider: SOCURE_PROVIDER_KEY,
            verification_id: updated.id,
            no_automatic_retry: true,
          },
        });
      } catch {
        // Keep the original safe error response if audit persistence fails.
      }
    }
    return Response.json({ error: category }, { status: 500 });
  }
});
