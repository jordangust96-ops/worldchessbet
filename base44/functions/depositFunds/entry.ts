import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Server-authoritative deposit handler. The client only ever sends the
// requested amount — the resulting balance is always computed here from the
// wallet's current, server-fetched value, so a client can never dictate its
// own balance directly.
const MAX_DEPOSIT_AMOUNT = 10000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { amount } = await req.json();
    const requestedAmount = Number(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > MAX_DEPOSIT_AMOUNT) {
      return Response.json({ error: 'Invalid funding amount' }, { status: 400 });
    }

    // Only Verified accounts may deposit funds (Provisional/Suspended/Closed cannot).
    if (user.account_state !== 'verified') {
      return Response.json({
        eligible: false,
        reason: user.account_state === 'suspended'
          ? 'Your account is currently suspended and cannot deposit funds.'
          : user.account_state === 'closed'
          ? 'This account is closed and cannot deposit funds.'
          : 'You must complete identity verification before you can deposit funds.',
      });
    }

    // Re-verify eligibility server-side rather than trusting a prior client-side check.
    const geoRes = await base44.functions.invoke('checkGeolocation', {});
    if (geoRes.data?.error || !geoRes.data?.eligible) {
      return Response.json({
        eligible: false,
        reason: geoRes.data?.reason || 'You are not currently eligible to fund your account.',
      });
    }

    const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    let wallet = wallets[0];
    if (!wallet) {
      wallet = await base44.asServiceRole.entities.Wallet.create({
        user_id: user.id,
        balance: 0,
        total_wagered: 0,
        total_won: 0,
        total_deposited: 0,
        total_withdrawn: 0,
      });
    }

    const updatedWallet = await base44.asServiceRole.entities.Wallet.update(wallet.id, {
      balance: (wallet.balance || 0) + requestedAmount,
      total_deposited: (wallet.total_deposited || 0) + requestedAmount,
    });

    await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'deposit',
      amount: requestedAmount,
      description: 'Account funded',
    });

    return Response.json({ eligible: true, wallet: updatedWallet });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});