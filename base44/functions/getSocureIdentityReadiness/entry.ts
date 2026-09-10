import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { identityConfig, identityWebhookConfig, readIdentityEvaluation } from '../../shared/socureIdentity.ts';
import { encryptComplianceJson } from '../../shared/kycEvidenceArchive.ts';
import { checkAtomicStoreHealth } from '../../shared/seamlessAtomicStore.ts';
import { classifyKyc } from '../../shared/socureKycPolicy.js';
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
  const body = await req.json().catch(() => ({}));
  let current_result;
  if (body.inspect_current_result === true) {
    try {
      const rows = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
        { user_id: caller.id }, '-requested_at', 1);
      const row = rows[0];
      if (row?.provider_evaluation_id) {
        const data = await readIdentityEvaluation(identityWebhookConfig(), row.provider_evaluation_id);
        const result = classifyKyc(data);
        current_result = {
          local_status: row.status, provider_decision: data.decision,
          eval_status: data.eval_status, evaluation_status: data.evaluation_status,
          correlation_matches: data.id === row.request_id,
          classified_status: result.status, failure_code: result.failure_code,
          top_level_keys: Object.keys(data),
          enrichment_shapes: (data.data_enrichments || []).map(e => ({
            provider: e.enrichment_provider, status: e.status_code,
            request_keys: Object.keys(e.request || {}), response_keys: Object.keys(e.response || {})
          }))
        };
      } else current_result = { available: false };
    } catch { current_result = { error: 'Provider result could not be retrieved' }; }
  }
  return Response.json({
    ...(current_result ? { current_result } : {}),
    ready: configuration && encryption && concurrency,
    configuration, encryption, concurrency, minimum_age: 21,
    workflow: 'consumer_onboarding', environment: 'production',
    bank_provider: 'seamless_ach_plaid',
    note: 'Configuration health does not certify a completed live KYC result or legal eligibility.'
  });
});
