import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';

// Legacy endpoint retained solely to prevent older clients from creating an
// internal-only funding entry. All production deposits must use the Plaid Link
// → exchangePlaidPublicToken → createPlaidTransfer flow.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (EARLY_ACCESS_MODE) {
    return Response.json({ eligible: false, reason: 'Bank deposits are disabled during Early Access. Your demo balance is unchanged.' });
  }
  return Response.json({
    eligible: false,
    reason: 'Connect a bank account with Plaid before funding your wallet.',
    action: 'plaid_link_required',
  });
});