import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  seamlessProviderApproved,
  paidContestsEnabled,
  seamlessDepositsEnabled,
  seamlessWithdrawalsEnabled,
  seamlessRtpPayoutsEnabled,
  seamlessHostedPlaidEnabled,
} from '../../shared/seamlessFundingConfig.ts';
import {
  atomicStoreEnabled,
  checkAtomicStoreHealth,
} from '../../shared/seamlessAtomicStore.ts';

function configured(name: string) {
  return !!(Deno.env.get(name) || '').trim();
}

// Admin-only, read-only readiness probe. It exposes booleans only, never
// provider credentials, and does not contact a money-movement endpoint.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me().catch(() => null);
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
      ['production', 'sandbox'].includes(environment) &&
      configured('SEAMLESS_ACH_PUBLIC_KEY') &&
      configured('SEAMLESS_ACH_SECRET_KEY');
    const hostedPlaidEnabled = seamlessHostedPlaidEnabled();
    const configurationReady = providerConfigured && atomicConfigured && atomicReachable;
    const blockers = [
      !seamlessProviderApproved() && 'provider_approval_pending',
      !providerConfigured && 'provider_configuration_incomplete',
      !atomicReachable && 'atomic_store_unavailable',
      !hostedPlaidEnabled && 'hosted_plaid_disabled',
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
      blockers,
      environment,
      provider_configured: providerConfigured,
      hosted_plaid_enabled: hostedPlaidEnabled,
      atomic_store_configured: atomicConfigured,
      atomic_store_reachable: atomicReachable,
      atomic_store_error: atomicError,
      deposits_enabled: seamlessDepositsEnabled(),
      withdrawals_enabled: seamlessWithdrawalsEnabled(),
      rtp_payouts_enabled: seamlessRtpPayoutsEnabled(),
      checked_at: new Date().toISOString(),
    });
  } catch {
    return Response.json({ error: 'Unable to determine Seamless readiness' }, { status: 500 });
  }
});
