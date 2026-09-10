import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityConfig } from '../../shared/socureIdentity.ts';
import { encryptComplianceJson } from '../../shared/kycEvidenceArchive.ts';
import { checkAtomicStoreHealth } from '../../shared/seamlessAtomicStore.ts';
// Read-only health probe: no identity evaluation, PII submission, or billable provider call.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const caller = await base44.auth.me().catch(() => null);
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  let configuration = false, encryption = false, concurrency = false;
  try { configuration = identityConfig().enabled === true; } catch {}
  try { await encryptComplianceJson({ readiness: true }); encryption = true; } catch {}
  try { await checkAtomicStoreHealth(); concurrency = true; } catch {}
  return Response.json({
    ready: configuration && encryption && concurrency,
    configuration, encryption, concurrency, minimum_age: 21,
    workflow: 'consumer_onboarding', environment: 'production',
    bank_provider: 'seamless_ach_plaid',
    note: 'Configuration health does not certify a completed live KYC result or legal eligibility.'
  });
});
