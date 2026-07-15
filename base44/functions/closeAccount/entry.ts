import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Self-service account closure. Runs server-side with the service role so
// contest cancellations, refunds, and the closure payout are always computed
// from the server's own records — never trusted from the client.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (user.account_state === 'closed') {
      return Response.json({ error: 'This account is already closed' }, { status: 400 });
    }

    // (i) Cancel any open Contest invitations — hosted/accepted contests that
    // have not yet fully started (searching, matched, or one-sided deposit),
    // refunding any escrowed deposit already made. Contests already
    // "in_progress" are left to settle normally per (iii).
    const [asHost, asOpponent] = await Promise.all([
      base44.asServiceRole.entities.Match.filter({ player1_id: user.id }),
      base44.asServiceRole.entities.Match.filter({ player2_id: user.id }),
    ]);
    const openInvitations = [...asHost, ...asOpponent].filter((m) =>
      ['searching', 'matched', 'deposited'].includes(m.status)
    );

    for (const match of openInvitations) {
      const refundTargets = [];
      if (match.player1_deposited) refundTargets.push(match.player1_id);
      if (match.player2_deposited) refundTargets.push(match.player2_id);

      for (const depositorId of refundTargets) {
        const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: depositorId });
        if (wallets.length > 0) {
          const wallet = wallets[0];
          await base44.asServiceRole.entities.Wallet.update(wallet.id, {
            balance: wallet.balance + match.wager_amount,
            total_wagered: Math.max(0, (wallet.total_wagered || 0) - match.wager_amount),
          });
          await base44.asServiceRole.entities.WalletTransaction.create({
            user_id: depositorId,
            type: 'wager_refund',
            amount: match.wager_amount,
            match_id: match.id,
            description: 'Reserved contest funds refunded — account closure',
            status: 'completed',
          });
        }
      }

      await base44.asServiceRole.entities.Match.update(match.id, { status: 'cancelled' });
    }

    // (iv) Disburse any remaining undisputed balance, subject to compliance
    // holds. A withdrawal_hold means the balance stays put pending review.
    let payout = null;
    if (!user.withdrawal_hold) {
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
      const wallet = wallets[0];
      if (wallet && wallet.balance > 0) {
        payout = wallet.balance;
        await base44.asServiceRole.entities.Wallet.update(wallet.id, {
          balance: 0,
          total_withdrawn: (wallet.total_withdrawn || 0) + wallet.balance,
        });
        await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: user.id,
          type: 'withdrawal',
          amount: payout,
          description: 'Account closure disbursement',
          status: 'pending',
        });
      }
    }

    // (v) Transition the Account to Closed status — this also blocks new
    // deposits, withdrawals, and contest entry per the existing account_state gate.
    const updatedUser = await base44.asServiceRole.entities.User.update(user.id, {
      account_state: 'closed',
    });

    return Response.json({
      success: true,
      cancelled_invitations: openInvitations.length,
      payout_pending: payout,
      held_for_compliance: !!user.withdrawal_hold,
      user: updatedUser,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});