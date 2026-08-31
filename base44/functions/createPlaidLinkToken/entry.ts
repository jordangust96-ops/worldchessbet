import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import { plaid } from '../../shared/plaid.ts';

Deno.serve(async (req) => {
  try {
    if (EARLY_ACCESS_MODE) return Response.json({ enabled: false, reason: 'Bank linking is unavailable during Early Access.' });
    const base44 = createClientFromRequest(req); const user = await base44.auth.me();
    if (!user || !isSocureIdentityVerified(user)) return Response.json({ error: 'Verified account required' }, { status: 403 });
    const data = await plaid('/link/token/create', {
      client_name: 'ChessBet', country_codes: ['US'], language: 'en',
      products: ['transfer'], user: { client_user_id: user.id },
      account_filters: { depository: { account_subtypes: ['checking', 'savings'] } },
    });
    return Response.json({ enabled: true, link_token: data.link_token, expiration: data.expiration });
  } catch (error) { return Response.json({ error: error?.message || 'Unable to start bank linking' }, { status: 500 }); }
});