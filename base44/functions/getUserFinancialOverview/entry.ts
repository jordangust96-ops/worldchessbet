import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Admin-only aggregator for the builder-facing "user lifetime wagering
// activity" view: wallet balance, amount wagered, amount won, amount lost,
// and total platform service fees paid, per user.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const [users, wallets, feeCharges, feeRefunds] = await Promise.all([
      base44.asServiceRole.entities.User.list('-created_date', 1000),
      base44.asServiceRole.entities.Wallet.list('-created_date', 1000),
      base44.asServiceRole.entities.WalletTransaction.filter({ type: 'service_fee_charge' }, '-created_date', 5000),
      base44.asServiceRole.entities.WalletTransaction.filter({ type: 'service_fee_refund' }, '-created_date', 5000),
    ]);

    const walletByUser = {};
    for (const w of wallets) {
      walletByUser[w.user_id] = w;
    }

    const feesByUser = {};
    for (const t of feeCharges) {
      feesByUser[t.user_id] = (feesByUser[t.user_id] || 0) + (t.amount || 0);
    }
    for (const t of feeRefunds) {
      feesByUser[t.user_id] = (feesByUser[t.user_id] || 0) - (t.amount || 0);
    }

    const rows = users.map((u) => {
      const wallet = walletByUser[u.id];
      const totalWagered = wallet?.total_wagered || 0;
      const totalWon = wallet?.total_won || 0;
      return {
        id: u.id,
        full_name: u.full_name || '',
        email: u.email || '',
        wallet_balance: wallet?.balance || 0,
        amount_wagered: totalWagered,
        amount_won: totalWon,
        amount_lost: Math.max(totalWagered - totalWon, 0),
        total_platform_fees: Math.max(feesByUser[u.id] || 0, 0),
      };
    });

    return Response.json({ rows });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});