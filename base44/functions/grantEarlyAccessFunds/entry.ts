import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { ensureEarlyAccessFunds } from '../../shared/earlyAccessFunding.ts';

// PRE-LAUNCH TESTING ONLY. While EARLY_ACCESS_MODE is true (see
// base44/shared/earlyAccess.ts), this function grants every user a one-time
// $500 bonus balance so they can host/accept challenges and exercise the
// full platform flow without a real deposit. The credit is posted through
// the same double-entry Internal Ledger as a real deposit (Debit Settlement,
// Credit User Available Balance) and recorded as a normal WalletTransaction,
// so it shows up in the user's transaction history exactly like a deposit
// would. Each wallet is only ever credited once (early_access_credited).
//
// Once EARLY_ACCESS_MODE is switched to false before public launch, this
// function becomes a no-op that only ensures a Wallet record exists — no
// further bonus balance is ever granted.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    return Response.json(await ensureEarlyAccessFunds(base44, user.id));
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});