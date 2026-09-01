import { createClientFromRequest } from 'npm:@base44/sdk';
import { ensureUserWallet } from '../../shared/walletProvisioning.ts';

// Legacy compatibility endpoint. It provisions only a zero-balance wallet and
// never creates a transaction, ledger entry, or promotional credit.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const wallet = await ensureUserWallet(base44, user.id);
    return Response.json({ wallet });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to provision wallet' }, { status: 500 });
  }
});
