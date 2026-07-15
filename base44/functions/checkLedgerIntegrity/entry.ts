import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Validates the core Internal Ledger invariant:
//   Total User Balances + Platform Revenue + Suspense = Deposits - Withdrawals
// If it fails, raises a manual-review IntegrityFlag instead of failing silently.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const wallets = await base44.asServiceRole.entities.Wallet.list(null, 5000);
    const userTotalSum = wallets.reduce((s, w) => s + (w.available_balance || 0) + (w.held_balance || 0), 0);

    const accounts = await base44.asServiceRole.entities.SystemLedgerAccount.list(null, 100);
    const revenue = accounts.find((a) => a.account_name === 'platform_revenue')?.balance || 0;
    const suspense = accounts.find((a) => a.account_name === 'suspense')?.balance || 0;

    const settlementEntries = await base44.asServiceRole.entities.LedgerEntry.filter(
      { ledger_account: 'settlement' }, null, 5000
    );
    const deposits = settlementEntries
      .filter((e) => e.transaction_type === 'deposit')
      .reduce((s, e) => s + (e.debit_amount || 0), 0);
    const withdrawals = settlementEntries
      .filter((e) => e.transaction_type === 'withdrawal')
      .reduce((s, e) => s + (e.credit_amount || 0), 0);

    const lhs = userTotalSum + revenue + suspense;
    const rhs = deposits - withdrawals;
    const diff = Math.round((lhs - rhs) * 100) / 100;
    const balanced = Math.abs(diff) < 0.01;

    if (!balanced) {
      await base44.asServiceRole.entities.IntegrityFlag.create({
        user_id: '',
        flag_type: 'manual',
        severity: 'high',
        status: 'open',
        description: `Ledger reconciliation failed: user balances (${userTotalSum}) + revenue (${revenue}) + suspense (${suspense}) = ${lhs}, but deposits (${deposits}) - withdrawals (${withdrawals}) = ${rhs}. Diff: ${diff}.`,
        notes: 'Auto-raised by checkLedgerIntegrity. Requires manual reconciliation review.',
      });
    }

    return Response.json({
      balanced,
      user_total_balance: userTotalSum,
      platform_revenue: revenue,
      suspense,
      deposits,
      withdrawals,
      diff,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});