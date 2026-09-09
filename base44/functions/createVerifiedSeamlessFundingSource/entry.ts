import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Retired compatibility endpoint. Raw routing and account numbers are no
// longer accepted by ChessBet; bank details are collected and verified only
// inside Seamless's hosted Plaid authorization flow.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({
    error: 'manual_bank_entry_retired',
    action: 'use_seamless_hosted_plaid',
  }, { status: 410 });
});
