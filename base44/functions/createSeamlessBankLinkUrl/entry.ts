import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Retired compatibility route. ChessBet now owns ACH authorization and uses
// POST /on-demand/funding-source only after Socure Account Intelligence accepts
// the account. Keeping this authenticated tombstone makes old clients fail
// clearly without returning a hosted Plaid-style URL or calling any provider.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    return Response.json({
      enabled: false,
      error: 'hosted_bank_link_retired',
      reason: 'Use verified third-party funding source enrollment.',
    }, { status: 410 });
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
});