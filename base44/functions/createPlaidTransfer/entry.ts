import { createClientFromRequest } from 'npm:@base44/sdk';

// ChessBet does not use a direct Plaid integration. Keep this legacy endpoint
// fail-closed so old clients cannot initiate a bank-link or transfer workflow.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ enabled: false, error: 'This legacy bank integration is not available.' }, { status: 410 });
});
