import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  seamlessDepositsEnabled,
  seamlessWithdrawalsEnabled,
  seamlessRtpPayoutsEnabled,
} from '../../shared/seamlessFundingConfig.ts';
import {
  atomicStoreEnabled,
  checkAtomicStoreHealth,
} from '../../shared/seamlessAtomicStore.ts';

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

    return Response.json({
      ready: providerConfigured && atomicConfigured && atomicReachable,
      environment,
      provider_configured: providerConfigured,
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
