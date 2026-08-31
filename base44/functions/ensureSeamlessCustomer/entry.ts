import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import {
  seamlessConfig, seamlessRequest, buildCreateCustomerBody,
  PATH_CREATE_CUSTOMER, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';

// Idempotently ensures a Seamless ACH customer exists for the authenticated
// user. If a SeamlessPaymentProfile already exists for this user, its
// provider_user_id is returned without a second provider call. Otherwise a
// POST /user is made and the returned user_id is persisted in a user-scoped
// profile. Fails closed on Early Access or missing/invalid configuration.
Deno.serve(async (req) => {
  try {
    if (EARLY_ACCESS_MODE) {
      return Response.json({
        enabled: false,
        reason: 'Bank linking is unavailable during Early Access.',
      });
    }

    // Resolve config up front so the function fails closed if secrets are
    // missing/invalid — before any entity work.
    const cfg = seamlessConfig();

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isSocureIdentityVerified(user) || user.withdrawal_hold) {
      return Response.json({ error: 'Verified account required for bank linking' }, { status: 403 });
    }

    const existing = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0];
    if (existing && existing.provider_user_id) {
      return Response.json({
        enabled: true,
        provider_user_id: existing.provider_user_id,
        profile_id: existing.id,
        created: false,
      });
    }

    // Derive a best-effort first/last name. ChessBet users register by email
    // and may not have a structured full_name; fall back gracefully.
    const fullName = (user.full_name || user.name || '').trim();
    const [firstName, ...rest] = fullName.split(/\s+/);
    const lastName = rest.length ? rest.join(' ') : firstName || 'Player';
    const body = buildCreateCustomerBody({
      firstName: firstName || 'ChessBet',
      lastName,
      email: user.email,
      phone: (user as any).phone || undefined,
    });

    const data = await seamlessRequest('POST', PATH_CREATE_CUSTOMER, body);
    const providerUserId = data?.user_id || data?.id || data?.userId;
    if (!providerUserId) throw new Error('Seamless did not return a user_id');

    const profile = await base44.asServiceRole.entities.SeamlessPaymentProfile.create({
      user_id: user.id,
      provider_user_id: String(providerUserId),
      provider_key: SEAMLESS_PROVIDER_KEY,
      status: 'created',
      created_at: new Date().toISOString(),
    });

    return Response.json({
      enabled: true,
      provider_user_id: String(providerUserId),
      profile_id: profile.id,
      created: true,
      env: cfg.env,
    });
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Unable to create Seamless customer' },
      { status: 500 }
    );
  }
});