import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  seamlessConfig, buildBankLinkUrl, SEAMLESS_PLAID_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { seamlessHostedPlaidEnabled } from '../../shared/seamlessFundingConfig.ts';
import { legalNameFromUser } from '../../shared/legalName.ts';
import {
  ACH_AUTHORIZATION_TEXT, ACH_AUTHORIZATION_VERSION,
  complianceRetentionUntil, requestIpAddress,
} from '../../shared/achAuthorization.js';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

function trustedAppOrigin(req: Request, environment: string) {
  const raw = String(req.headers.get('origin') || '').trim();
  try {
    const url = new URL(raw);
    const productionHost =
      url.protocol === 'https:' &&
      (url.hostname === 'worldchessbet.com' ||
       url.hostname === 'www.worldchessbet.com' ||
       url.hostname.endsWith('.base44.app'));
    const sandboxHost =
      environment === 'sandbox' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (productionHost || sandboxHost) return url.origin;
  } catch {
    // Reject absent, malformed, or untrusted redirect origins.
  }
  throw new Error('trusted_app_origin_required');
}

// Creates a short-lived handoff to Seamless's hosted Plaid authorization.
// The public URL is safe for the browser; secret keys and bank credentials
// never enter ChessBet. A browser success message is only UX feedback—the
// funding-source.verified webhook remains the sole verification authority.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!seamlessHostedPlaidEnabled()) {
      return Response.json({ enabled: false, reason: 'Secure bank connection is unavailable right now.' }, { status: 409 });
    }
    if (['suspended', 'closed'].includes(user.account_state || '')) {
      return Response.json({ error: 'This account cannot add a bank connection.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const legalName = legalNameFromUser(user);
    if (!legalName) {
      return Response.json({ error: 'legal_name_required' }, { status: 409 });
    }
    const signerName = String(body?.signerName || '').trim();
    if (signerName.toLocaleLowerCase('en-US') !== legalName.fullName.toLocaleLowerCase('en-US')) {
      return Response.json({ error: 'signature_mismatch' }, { status: 400 });
    }
    if (body?.consentAccepted !== true || body?.authorizationVersion !== ACH_AUTHORIZATION_VERSION) {
      return Response.json({ error: 'ach_authorization_required' }, { status: 400 });
    }

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0];
    if (!profile?.provider_user_id) {
      return Response.json({ error: 'seamless_customer_required', action: 'ensure_customer' }, { status: 409 });
    }

    const cfg = seamlessConfig();
    const origin = trustedAppOrigin(req, cfg.env);
    const attemptId = crypto.randomUUID();
    const acceptedAt = new Date().toISOString();

    const existing = await base44.asServiceRole.entities['ach-debit-authorization'].filter(
      { user_id: user.id, status: 'active' }, '-accepted_at', 20
    );
    for (const authorization of existing) {
      if (!authorization.funding_source_id) {
        await base44.asServiceRole.entities['ach-debit-authorization'].update(authorization.id, {
          status: 'superseded',
          revoked_at: acceptedAt,
        });
      }
    }

    const authorization = await base44.asServiceRole.entities['ach-debit-authorization'].create({
      user_id: user.id,
      signer_name: signerName,
      signature_method: 'authenticated_clickwrap',
      authorization_version: ACH_AUTHORIZATION_VERSION,
      authorization_text: ACH_AUTHORIZATION_TEXT,
      accepted_at: acceptedAt,
      ip_address: requestIpAddress(req),
      user_agent: String(req.headers.get('user-agent') || '').slice(0, 1000),
      status: 'active',
      enrollment_id: attemptId,
      provider_key: SEAMLESS_PLAID_PROVIDER_KEY,
      provider_user_id: profile.provider_user_id,
      retention_until: complianceRetentionUntil(acceptedAt),
      description: 'Standing ACH authorization accepted before Seamless hosted Plaid bank verification.',
    });

    const linkUrl = buildBankLinkUrl({
      env: cfg.env,
      publicKey: cfg.publicKey,
      providerUserId: profile.provider_user_id,
      successUrl: `${origin}/wallet?bank_link=success`,
      cancelUrl: `${origin}/wallet?bank_link=cancelled`,
    });

    await recordIntegrationEvent(base44, {
      eventType: 'financial.seamless_plaid_authorization_started',
      aggregateType: 'user',
      aggregateId: user.id,
      correlationId: attemptId,
      idempotencyKey: `seamless:plaid-link:${attemptId}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      status: 'pending',
      result: 'hosted_flow_started',
      eventData: {
        provider: SEAMLESS_PLAID_PROVIDER_KEY,
        profile_id: profile.id,
        authorization_id: authorization.id,
      },
    });

    return Response.json({
      enabled: true,
      link_url: linkUrl,
      provider_origin: new URL(linkUrl).origin,
      authorization_id: authorization.id,
    });
  } catch (error) {
    const message = String(error?.message || '');
    console.error(JSON.stringify({
      event: 'seamless_bank_link_failed',
      reason: (message || 'unknown_error').slice(0, 240),
    }));
    if (message === 'trusted_app_origin_required') {
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json({ error: message || 'Unable to start secure bank connection' }, { status: 500 });
  }
});
