import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  seamlessProviderApproved,
  paidContestsEnabled,
  seamlessDepositsEnabled,
  seamlessWithdrawalsEnabled,
  seamlessRtpPayoutsEnabled,
  seamlessThirdPartyFundingEnabled,
} from '../../shared/seamlessFundingConfig.ts';
import {
  atomicStoreEnabled,
  checkAtomicStoreHealth,
} from '../../shared/seamlessAtomicStore.ts';

import { socureConfig } from '../../shared/socure.ts';

function configured(name: string) {
  return !!(Deno.env.get(name) || '').trim();
}

// Admin-only, read-only production readiness probe. It never returns secret
// values and does not contact a payment-movement endpoint.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const atomicConfigured = atomicStoreEnabled();
    let atomicReachable = false;
    let atomicError = '';
    if (atomicConfigured) {
      try {
        atomicReachable = await checkAtomicStoreHealth();
      } catch {
        atomicError = 'Atomic store is configured but unreachable';
      }
    } else {
      atomicError = 'Atomic store is not configured';
    }

    const environment = (Deno.env.get('SEAMLESS_ACH_ENV') || '').trim().toLowerCase();
    const providerConfigured =
      environment === 'production' &&
      configured('SEAMLESS_ACH_PUBLIC_KEY') &&
      configured('SEAMLESS_ACH_SECRET_KEY');
    const complianceEvidenceConfigured = configured('KYC_AUDIT_ENCRYPTION_KEY');
    const identityEnabled =
      (Deno.env.get('SOCURE_IDENTITY_ENABLED') || '').trim().toLowerCase() === 'true';
    const identityEnvironment =
      (Deno.env.get('SOCURE_IDENTITY_ENV') || '').trim().toLowerCase();
    const identityWorkflow = (Deno.env.get('SOCURE_IDENTITY_WORKFLOW') || '').trim();
    const identityWorkflowConfigured =
      !!identityWorkflow && identityWorkflow !== 'account_intelligence_screening';
    const identityConfigured =
      identityEnabled &&
      identityEnvironment === 'production' &&
      configured('SOCURE_IDENTITY_API_KEY') &&
      configured('SOCURE_IDENTITY_RETURN_URL') &&
      configured('SOCURE_IDENTITY_WEBHOOK_TOKEN') &&
      identityWorkflowConfigured &&
      complianceEvidenceConfigured;
    const thirdPartyFundingEnabled = seamlessThirdPartyFundingEnabled();
    let bankScreeningConfigured = false;
    try { bankScreeningConfigured = socureConfig().enabled === true; } catch { /* fail closed */ }
    const configurationReady = providerConfigured && atomicConfigured && atomicReachable && identityConfigured && bankScreeningConfigured;
    const blockers = [
      !seamlessProviderApproved() && 'provider_approval_pending',
      !providerConfigured && 'provider_configuration_incomplete',
      !atomicReachable && 'atomic_store_unavailable',
      !identityConfigured && 'identity_configuration_incomplete',
      !bankScreeningConfigured && 'bank_screening_configuration_incomplete',
      !thirdPartyFundingEnabled && 'bank_enrollment_disabled',
      !seamlessDepositsEnabled() && 'deposits_disabled',
      !seamlessWithdrawalsEnabled() && 'withdrawals_disabled',
      !paidContestsEnabled() && 'paid_contests_disabled',
    ].filter(Boolean);

    return Response.json({
      // Configuration readiness is not proof of provider acceptance or delivery.
      ready: configurationReady && blockers.length === 0,
      readiness_scope: 'configuration_only',
      configuration_ready: configurationReady,
      provider_approved: seamlessProviderApproved(),
      paid_contests_enabled: paidContestsEnabled(),
      bank_screening_configured: bankScreeningConfigured,
      blockers,
      environment,
      provider_configured: providerConfigured,
      atomic_store_configured: atomicConfigured,
      atomic_store_reachable: atomicReachable,
      atomic_store_error: atomicError,
      deposits_enabled: seamlessDepositsEnabled(),
      withdrawals_enabled: seamlessWithdrawalsEnabled(),
      rtp_payouts_enabled: seamlessRtpPayoutsEnabled(),
      third_party_funding_enabled: thirdPartyFundingEnabled,
      compliance_evidence_configured: complianceEvidenceConfigured,
      identity_enabled: identityEnabled,
      identity_configured: identityConfigured,
      identity_workflow_configured: identityWorkflowConfigured,
      checked_at: new Date().toISOString(),
    });
  } catch {
    return Response.json({ error: 'Unable to determine Seamless readiness' }, { status: 500 });
  }
});
