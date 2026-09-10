import { bankOnboardingEligibility } from '../../shared/bankOnboardingEligibility.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  seamlessConfig, seamlessRequest, buildCreateCustomerBody,
  PATH_CREATE_CUSTOMER, SEAMLESS_PROVIDER_KEY, pickSeamlessCustomerId,
} from '../../shared/seamlessAch.ts';
import { seamlessHostedPlaidEnabled } from '../../shared/seamlessFundingConfig.ts';
import { legalNameFromUser } from '../../shared/legalName.ts';

// Idempotently creates the Seamless customer required by the hosted Plaid
// authorization flow. New/provisional users may create a profile so bank
// verification can become their authoritative account-verification signal.
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({error:'Method not allowed'},{status:405});
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const eligibilityError = await bankOnboardingEligibility(req,base44,user);
    if (eligibilityError) return Response.json(eligibilityError,{status:403});
    if (!seamlessHostedPlaidEnabled()) {
      return Response.json({ enabled: false, reason: 'Secure bank connection is unavailable right now.' }, { status: 409 });
    }
    const cfg = seamlessConfig();
    if (['suspended', 'closed'].includes(user.account_state || '')) {
      return Response.json({ error: 'This account cannot add a bank connection.' }, { status: 403 });
    }

    const existing = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0];
    if (existing?.provider_user_id) {
      return Response.json({
        enabled: true,
        provider_user_id: existing.provider_user_id,
        profile_id: existing.id,
        created: false,
        env: cfg.env,
      });
    }

    const legalName = legalNameFromUser(user);
    if (!legalName) {
      return Response.json({ error: 'A valid legal first and last name are required.' }, { status: 409 });
    }

    const data = await seamlessRequest('POST', PATH_CREATE_CUSTOMER, buildCreateCustomerBody({
      firstName: legalName.firstName,
      lastName: legalName.lastName,
      email: user.email,
      phone: (user as any).phone || undefined,
    }));
    const providerUserId = pickSeamlessCustomerId(data);
    if (!providerUserId) throw new Error('Seamless did not return a user_id');

    const duplicate = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0];
    if (duplicate?.provider_user_id) {
      return Response.json({
        enabled: true,
        provider_user_id: duplicate.provider_user_id,
        profile_id: duplicate.id,
        created: false,
        env: cfg.env,
      });
    }

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
    const providerStatus = Number(error?.status) || undefined;
    console.error(JSON.stringify({
      event: 'seamless_customer_setup_failed',
      provider_status: providerStatus,
      reason: String(error?.message || 'unknown').slice(0, 240),
    }));
    return Response.json(
      { error: 'Unable to set up the secure bank connection. Please try again.' },
      { status: providerStatus ? 502 : 500 }
    );
  }
});
