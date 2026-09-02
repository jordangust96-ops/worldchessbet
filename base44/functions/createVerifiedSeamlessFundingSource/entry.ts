import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  ACH_AUTHORIZATION_TEXT,
  ACH_AUTHORIZATION_VERSION,
  complianceRetentionUntil,
  normalizeBankDigits,
  requestIpAddress,
} from '../../shared/achAuthorization.js';
import { encryptComplianceJson } from '../../shared/complianceEvidence.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { legalNameFromUser } from '../../shared/legalName.ts';
import {
  buildVerifiedThirdPartyFundingSourceBody,
  PATH_VERIFIED_THIRD_PARTY_FUNDING_SOURCE,
  SEAMLESS_PROVIDER_KEY,
  seamlessConfig,
  seamlessRequest,
} from '../../shared/seamlessAch.ts';
import { seamlessThirdPartyFundingEnabled } from '../../shared/seamlessFundingConfig.ts';
import {
  SOCURE_PROVIDER_KEY,
  evaluateSocureBankAccount,
  sha256Hex,
  socureConfig,
} from '../../shared/socure.ts';

function cleanText(value: unknown, max: number) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function sameName(left: string, right: string) {
  const normalize = (value: string) => cleanText(value, 200).toLocaleLowerCase('en-US');
  return normalize(left) === normalize(right);
}

function firstByCreated(records: any[]) {
  return [...records].sort((a, b) =>
    new Date(a?.created_date || 0).getTime() - new Date(b?.created_date || 0).getTime() ||
    String(a?.id || '').localeCompare(String(b?.id || ''))
  )[0] || null;
}

function publicEnrollment(enrollment: any) {
  if (!enrollment) return null;
  return {
    id: enrollment.id,
    state: enrollment.state,
    account_last_four: enrollment.account_last_four || '',
    bank_name: enrollment.bank_name || '',
    requested_at: enrollment.requested_at || '',
    completed_at: enrollment.completed_at || '',
  };
}

function extractSocureSignals(response: any) {
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
  return {
    decision,
    accountStatus,
    availabilityScore: typeof signals?.availabilityScore === 'number' ? signals.availabilityScore : undefined,
    ownershipScore: typeof signals?.ownershipScore === 'number' ? signals.ownershipScore : undefined,
    reasonCodes: Array.isArray(signals?.reasonCodes)
      ? signals.reasonCodes.filter((item: unknown) => typeof item === 'string').slice(0, 20)
      : [],
    evaluationId: typeof response?.eval_id === 'string' ? response.eval_id : '',
    referenceId: typeof signals?.referenceId === 'string' ? signals.referenceId : '',
  };
}

function extractFundingSource(response: any) {
  const source = response?.funding_source || response?.data?.funding_source || response?.data || response || {};
  return {
    id: cleanText(
      source?.funding_source_id || source?.source_id || source?.id ||
      response?.funding_source_id || response?.source_id,
      255
    ),
    status: cleanText(source?.status || response?.status, 64).toLowerCase(),
    bankName: cleanText(source?.bank_name || source?.bank || response?.bank_name, 200),
    lastFour: normalizeBankDigits(
      source?.last_four || source?.account_last_four || source?.mask || response?.last_four
    ).slice(-4),
  };
}

Deno.serve(async (req) => {
  let base44: any = null;
  let user: any = null;
  let enrollment: any = null;
  let screening: any = null;
  let providerRequestStarted = false;

  try {
    base44 = createClientFromRequest(req);
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // The provider-approved route is inert until this exact server-side flag is true.
    if (!seamlessThirdPartyFundingEnabled()) {
      return Response.json({
        enabled: false,
        reason: 'Verified bank linking is awaiting provider approval.',
      }, { status: 503 });
    }

    // Resolve both provider configurations before accepting or persisting consent.
    seamlessConfig();
    const bankScreenConfig = socureConfig();
    if (!bankScreenConfig.enabled) {
      return Response.json({ error: 'Bank account screening is not enabled.' }, { status: 503 });
    }
    if (!isSocureIdentityVerified(user) || user.withdrawal_hold) {
      return Response.json({ error: 'Complete identity verification before linking a bank account.' }, { status: 403 });
    }

    const body = await req.json();
    const routingNumber = normalizeBankDigits(body?.routingNumber);
    const accountNumber = normalizeBankDigits(body?.accountNumber);
    const accountType = body?.accountType === 'savings' ? 'savings' : body?.accountType === 'checking' ? 'checking' : '';
    const bankName = cleanText(body?.bankName, 200);
    const signerName = cleanText(body?.signerName, 200);
    const consentAccepted = body?.consentAccepted === true;
    const authorizationVersion = cleanText(body?.authorizationVersion, 64);

    if (!/^\d{9}$/.test(routingNumber) || !/^\d{4,34}$/.test(accountNumber) ||
        !accountType || !bankName || !signerName || !consentAccepted ||
        authorizationVersion !== ACH_AUTHORIZATION_VERSION) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const legalName = legalNameFromUser(user);
    if (!legalName || !sameName(signerName, legalName.fullName)) {
      return Response.json({
        error: 'Your electronic signature must match your verified legal name.',
        action: 'signature_mismatch',
      }, { status: 409 });
    }

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0];
    if (!profile?.provider_user_id) {
      return Response.json({ error: 'Create your payment profile first.', action: 'ensure_customer' }, { status: 400 });
    }

    // Bank enrollment enables future deposits, so apply the same fresh location gate.
    const jurisdiction = await base44.functions.invoke('getCurrentJurisdiction', {
      triggerEvent: 'bank_link_start',
      relatedEntityType: 'funding_source',
    });
    if (jurisdiction.data?.error || jurisdiction.data?.status !== 'approved') {
      return Response.json({
        error: jurisdiction.data?.reason || 'You are not currently eligible to link a funding account from this location.',
      }, { status: 403 });
    }

    const fingerprint = await sha256Hex(`${user.id}:${routingNumber}:${accountNumber}`);
    const requestKey = `seamless:verified-third-party:v1:${user.id}:${fingerprint}`;
    const existing = await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.filter({ request_key: requestKey });
    if (existing.length > 0) {
      const canonical = firstByCreated(existing);
      const status = canonical?.state === 'verified' ? 200 : 202;
      return Response.json({
        enabled: true,
        deduplicated: true,
        enrollment: publicEnrollment(canonical),
        reconciliation_required: canonical?.state === 'uncertain',
      }, { status });
    }

    const now = new Date().toISOString();
    enrollment = await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.create({
      user_id: user.id,
      provider_user_id: profile.provider_user_id,
      account_fingerprint: fingerprint,
      account_last_four: accountNumber.slice(-4),
      routing_last_four: routingNumber.slice(-4),
      account_type: accountType,
      bank_name: bankName,
      state: 'created',
      request_key: requestKey,
      requested_at: now,
      description: 'Awaiting Socure Account Intelligence screening.',
    });

    // Deterministic election suppresses concurrent attempts at the paid provider boundary.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const candidates = await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.filter({ request_key: requestKey });
    const canonical = firstByCreated(candidates);
    if (!canonical || canonical.id !== enrollment.id) {
      await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.update(enrollment.id, {
        state: 'failed',
        completed_at: new Date().toISOString(),
        error_code: 'duplicate_suppressed',
      });
      return Response.json({
        enabled: true,
        deduplicated: true,
        enrollment: publicEnrollment(canonical),
      }, { status: 202 });
    }

    // Preserve the full account evidence only as encrypted consent evidence.
    const bankEvidence = await encryptComplianceJson({
      routing_number: routingNumber,
      account_number: accountNumber,
      account_type: accountType,
      bank_name: bankName,
    });
    const authorization = await base44.asServiceRole.entities.AchDebitAuthorization.create({
      user_id: user.id,
      signer_name: signerName,
      signature_method: 'authenticated_clickwrap',
      authorization_version: ACH_AUTHORIZATION_VERSION,
      authorization_text: ACH_AUTHORIZATION_TEXT,
      accepted_at: now,
      ip_address: requestIpAddress(req),
      user_agent: cleanText(req.headers.get('user-agent'), 1000),
      bank_details_ciphertext: bankEvidence.ciphertext,
      bank_details_iv: bankEvidence.iv,
      bank_details_sha256: bankEvidence.sha256,
      routing_last_four: routingNumber.slice(-4),
      account_last_four: accountNumber.slice(-4),
      account_fingerprint: fingerprint,
      account_type: accountType,
      bank_name: bankName,
      status: 'active',
      enrollment_id: enrollment.id,
      retention_until: complianceRetentionUntil(now),
      description: 'Consumer authorization captured before bank screening and provider enrollment.',
    });
    enrollment = await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.update(enrollment.id, {
      authorization_id: authorization.id,
      state: 'screening',
    });

    const screeningRequestKey = `socure:bank:enrollment:v1:${enrollment.id}:${fingerprint}`;
    screening = await base44.asServiceRole.entities.SocureBankVerification.create({
      user_id: user.id,
      source_id: `pending:${enrollment.id}`,
      request_key: screeningRequestKey,
      account_fingerprint: fingerprint,
      workflow: bankScreenConfig.workflow,
      status: 'processing',
      decision: 'UNKNOWN',
      requested_by_user_id: user.id,
      requested_at: new Date().toISOString(),
    });

    const socureResponse = await evaluateSocureBankAccount({
      config: bankScreenConfig,
      evaluationId: `chessbet-enrollment-${enrollment.id}`,
      givenName: legalName.firstName,
      familyName: legalName.lastName,
      accountNumber,
      routingNumber,
    });
    const signals = extractSocureSignals(socureResponse);
    const accepted = signals.decision === 'ACCEPT' && signals.accountStatus !== 'CLOSED' && signals.accountStatus !== 'INVALID';
    screening = await base44.asServiceRole.entities.SocureBankVerification.update(screening.id, {
      status: accepted ? 'completed' : 'manual_review_required',
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

    if (!accepted) {
      enrollment = await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.update(enrollment.id, {
        state: 'manual_review_required',
        socure_verification_id: screening.id,
        completed_at: new Date().toISOString(),
        error_code: 'socure_bank_screening_not_accepted',
        description: 'No Seamless funding source was created.',
      });
      return Response.json({
        enabled: true,
        enrollment: publicEnrollment(enrollment),
        human_review_required: true,
      }, { status: 202 });
    }

    enrollment = await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.update(enrollment.id, {
      state: 'creating_provider_source',
      socure_verification_id: screening.id,
    });

    // This payload is based on Seamless's endpoint example. Keep the feature flag
    // false until Seamless confirms the production account and exact JSON contract.
    providerRequestStarted = true;
    const providerResponse = await seamlessRequest(
      'POST',
      PATH_VERIFIED_THIRD_PARTY_FUNDING_SOURCE,
      buildVerifiedThirdPartyFundingSourceBody({
        providerUserId: profile.provider_user_id,
        routingNumber,
        accountNumber,
        accountType,
        nickname: bankName,
      })
    );
    const providerSource = extractFundingSource(providerResponse);
    if (!providerSource.id || providerSource.status !== 'verified') {
      const providerError: any = new Error('provider_response_unverified');
      providerError.providerOutcomeUncertain = true;
      throw providerError;
    }

    const priorBanks = await base44.asServiceRole.entities.SeamlessBankAccount.filter({
      user_id: user.id,
      is_primary: true,
    });
    for (const bank of priorBanks) {
      await base44.asServiceRole.entities.SeamlessBankAccount.update(bank.id, { is_primary: false });
    }

    const completedAt = new Date().toISOString();
    const bank = await base44.asServiceRole.entities.SeamlessBankAccount.create({
      user_id: user.id,
      source_id: providerSource.id,
      profile_id: profile.id,
      provider_user_id: profile.provider_user_id,
      account_name: providerSource.bankName || bankName,
      account_mask: providerSource.lastFour || accountNumber.slice(-4),
      is_primary: true,
      rtp_eligible: false,
      rtp_eligibility_source: 'unknown',
      status: 'verified',
      added_at: completedAt,
      verified_at: completedAt,
      provider_event_at: completedAt,
      description: 'Verified third-party funding source created after Socure Account Intelligence acceptance.',
    });

    await base44.asServiceRole.entities.SocureBankVerification.update(screening.id, {
      source_id: providerSource.id,
    });
    await base44.asServiceRole.entities.AchDebitAuthorization.update(authorization.id, {
      funding_source_id: providerSource.id,
    });
    enrollment = await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.update(enrollment.id, {
      state: 'verified',
      provider_source_id: providerSource.id,
      completed_at: completedAt,
      error_code: '',
      description: 'Socure screening accepted and Seamless returned a verified funding source.',
    });

    await recordIntegrationEvent(base44, {
      eventType: 'payments.seamless_verified_third_party_source_created',
      aggregateType: 'user',
      aggregateId: user.id,
      correlationId: enrollment.id,
      idempotencyKey: `seamless:verified-third-party:created:${enrollment.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      status: 'verified',
      result: 'created',
      eventData: {
        provider: SEAMLESS_PROVIDER_KEY,
        bank_screening_provider: SOCURE_PROVIDER_KEY,
        enrollment_id: enrollment.id,
        authorization_id: authorization.id,
        bank_id: bank.id,
        source_id: providerSource.id,
      },
    });

    return Response.json({
      enabled: true,
      enrollment: publicEnrollment(enrollment),
      bank: {
        id: bank.id,
        account_name: bank.account_name,
        account_mask: bank.account_mask,
        status: bank.status,
        is_primary: bank.is_primary,
        socure_status: 'verified',
      },
    });
  } catch (error) {
    const socureCategory = cleanText((error as any)?.socureCategory, 128);
    const providerStatus = Number((error as any)?.status || 0);
    const providerUncertain = (error as any)?.providerOutcomeUncertain === true ||
      (providerRequestStarted && !socureCategory && (!providerStatus || providerStatus >= 500));
    const errorCode = socureCategory || (providerStatus ? `seamless_http_${providerStatus}` : 'internal_error');
    const state = socureCategory
      ? (socureCategory.includes('unknown_outcome') ? 'uncertain' : 'failed')
      : (providerUncertain ? 'uncertain' : 'failed');

    if (base44 && screening && socureCategory) {
      try {
        await base44.asServiceRole.entities.SocureBankVerification.update(screening.id, {
          status: socureCategory.includes('unknown_outcome') ? 'unknown_outcome' : 'failed',
          completed_at: new Date().toISOString(),
          error_code: socureCategory,
        });
      } catch {
        // Preserve the original safe response.
      }
    }
    if (base44 && enrollment) {
      try {
        enrollment = await base44.asServiceRole.entities.SeamlessFundingSourceEnrollment.update(enrollment.id, {
          state,
          completed_at: new Date().toISOString(),
          error_code: errorCode,
          description: state === 'uncertain'
            ? 'Provider outcome is uncertain. Do not retry automatically; reconcile with support.'
            : 'Enrollment failed before a verified funding source was confirmed.',
        });
        await recordIntegrationEvent(base44, {
          eventType: 'payments.seamless_verified_third_party_source_unresolved',
          aggregateType: 'user',
          aggregateId: user?.id || enrollment.user_id,
          correlationId: enrollment.id,
          idempotencyKey: `seamless:verified-third-party:unresolved:${enrollment.id}`,
          actorType: 'user',
          actorId: user?.id || '',
          userId: user?.id || enrollment.user_id,
          status: state,
          result: errorCode,
          eventData: {
            provider: SEAMLESS_PROVIDER_KEY,
            enrollment_id: enrollment.id,
            no_automatic_retry: state === 'uncertain',
          },
        });
      } catch {
        // Preserve the original safe response.
      }
    }

    return Response.json({
      error: state === 'uncertain'
        ? 'Bank enrollment requires reconciliation before retrying.'
        : 'Unable to link this bank account.',
      enrollment: publicEnrollment(enrollment),
      reconciliation_required: state === 'uncertain',
    }, { status: state === 'uncertain' ? 202 : 500 });
  }
});
