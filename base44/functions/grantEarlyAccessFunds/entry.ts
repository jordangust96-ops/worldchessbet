import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE, EARLY_ACCESS_STARTING_BALANCE } from '../../shared/earlyAccess.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';

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
const EARLY_ACCESS_DESCRIPTION = 'Early Access bonus balance — pre-launch testing credit';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    let wallet = wallets[0];
    if (!wallet) {
      wallet = await base44.asServiceRole.entities.Wallet.create({
        user_id: user.id, balance: 0, available_balance: 0, held_balance: 0, total_balance: 0,
        total_wagered: 0, total_won: 0, total_deposited: 0, total_withdrawn: 0, early_access_credited: false,
      });
    }

    if (!EARLY_ACCESS_MODE || wallet.early_access_credited) {
      return Response.json({ wallet });
    }

    const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'deposit',
      amount: EARLY_ACCESS_STARTING_BALANCE,
      description: EARLY_ACCESS_DESCRIPTION,
    });

    await postLedgerLegs(base44, {
      groupId: crypto.randomUUID(),
      walletTransactionId: walletTransaction.id,
      actor: 'system',
      triggerEvent: 'early_access_bonus',
      legs: [
        { ledgerAccount: 'settlement', debit: EARLY_ACCESS_STARTING_BALANCE, credit: 0, transactionType: 'deposit' },
        { ledgerAccount: 'user_account', userId: user.id, debit: 0, credit: EARLY_ACCESS_STARTING_BALANCE, transactionType: 'deposit', totalDepositedDelta: EARLY_ACCESS_STARTING_BALANCE },
      ],
    });

    await base44.asServiceRole.entities.Wallet.update(wallet.id, { early_access_credited: true });
    const finalWallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    return Response.json({ wallet: finalWallets[0] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});