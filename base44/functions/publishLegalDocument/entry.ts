import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { requireAdminMfa } from '../../shared/mfa.ts';

const VALID_POLICY_TYPES = new Set(['privacy_policy', 'terms_of_service', 'official_rules']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    const body = await req.json();
    const mfaError = await requireAdminMfa(base44, admin, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;

    const { policyType, supportEmail, contentMarkdown } = body;
    if (!VALID_POLICY_TYPES.has(policyType) || typeof contentMarkdown !== 'string' || !contentMarkdown.trim() || contentMarkdown.length > 200000) {
      return Response.json({ error: 'invalid_policy_document' }, { status: 400 });
    }
    if (typeof supportEmail !== 'string' || supportEmail.length > 254 || !supportEmail.includes('@')) {
      return Response.json({ error: 'invalid_support_email' }, { status: 400 });
    }

    const configs = await base44.asServiceRole.entities.PrivacyPolicyConfig.filter({ policy_type: policyType }, '-version');
    const active = configs.find((config) => config.is_active);
    const nextVersion = Math.max(0, ...configs.map((config) => Number(config.version) || 0)) + 1;
    if (active) await base44.asServiceRole.entities.PrivacyPolicyConfig.update(active.id, { is_active: false });

    const created = await base44.asServiceRole.entities.PrivacyPolicyConfig.create({
      policy_type: policyType,
      version: nextVersion,
      last_updated: new Date().toISOString().slice(0, 10),
      support_email: supportEmail.trim(),
      content_markdown: contentMarkdown,
      is_active: true,
    });
    return Response.json({ policy: created });
  } catch (error) {
    console.error(JSON.stringify({ event: 'publish_legal_document_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
