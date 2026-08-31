import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';

// Read-only view of the authenticated user's Seamless funding state for the
// Wallet page. Reads ONLY our own stored records (SeamlessPaymentProfile,
// SeamlessBankAccount, recent pending Seamless WalletTransactions) — it does
// NOT call the Seamless API. (No provider transaction readback endpoint is
// proven in the current Seamless ACH v2 references; that gap is flagged as a
// launch blocker in the build report.) Fails closed on Early Access.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const earlyAccess = !!EARLY_ACCESS_MODE;

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0] || null;

    const banks = await base44.asServiceRole.entities.SeamlessBankAccount.filter(
      { user_id: user.id }, '-added_at', 50
    );

    const [deposits, withdrawals] = await Promise.all([
      base44.asServiceRole.entities.WalletTransaction.filter(
        { user_id: user.id, source_event: 'seamless_deposit' }, '-created_date', 10
      ),
      base44.asServiceRole.entities.WalletTransaction.filter(
        { user_id: user.id, source_event: 'seamless_withdrawal' }, '-created_date', 10
      ),
    ]);
    const recent = [...deposits, ...withdrawals]
      .sort((a, b) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime())
      .slice(0, 10);

    return Response.json({
      early_access: earlyAccess,
      enabled: !earlyAccess,
      profile,
      banks,
      recent,
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to load funding state' }, { status: 500 });
  }
});