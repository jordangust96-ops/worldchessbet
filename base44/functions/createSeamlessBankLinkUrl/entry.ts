import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';
import {
  seamlessConfig, buildBankLinkUrl,
} from '../../shared/seamlessAch.ts';

// Builds the Seamless HOSTED bank-authorization URL (Plaid authorization hosted
// by Seamless, not direct Plaid Link in the browser). The URL is returned to the
// authenticated user only; the browser success/cancel callback is NEVER trusted
// as verification — only the funding-source.verified webhook persists a verified
// source_id. Fails closed on Early Access or missing configuration.
Deno.serve(async (req) => {
  try {
    if (EARLY_ACCESS_MODE) {
      return Response.json({
        enabled: false,
        reason: 'Bank linking is unavailable during Early Access.',
      });
    }

    const cfg = seamlessConfig(); // fail closed on missing/invalid env/keys

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.account_state !== 'verified' || user.withdrawal_hold) {
      return Response.json({ error: 'Verified account required for bank linking' }, { status: 403 });
    }

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0];
    if (!profile || !profile.provider_user_id) {
      return Response.json(
        { error: 'No Seamless customer profile. Call ensureSeamlessCustomer first.', action: 'ensure_customer' },
        { status: 400 }
      );
    }

    // successUrl/cancelUrl point back to the wallet page. The exact public host
    // is not derivable from the app name; prefer APP_URL when set.
    const appUrl = (Deno.env.get('APP_URL') || '').trim().replace(/\/$/, '');
    const walletPath = appUrl ? `${appUrl}/wallet` : '/wallet';
    const url = buildBankLinkUrl({
      env: cfg.env,
      publicKey: cfg.publicKey,
      providerUserId: profile.provider_user_id,
      successUrl: walletPath,
      cancelUrl: walletPath,
    });

    return Response.json({ enabled: true, url, env: cfg.env });
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Unable to build bank link URL' },
      { status: 500 }
    );
  }
});