import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { postLedgerLegs } from '../../shared/ledger.ts';

// Self-service account closure. Runs server-side with the service role so
// contest cancellations, refunds, and the closure payout are always computed
// via the Internal Ledger — never trusted from the client.

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
        const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: depositorId,
          type: 'wager_refund',
          amount: match.wager_amount,
          match_id: match.id,
          description: 'Reserved contest funds refunded — account closure',
          status: 'completed',
        });

        await postLedgerLegs(base44, {
          groupId: crypto.randomUUID(),
          matchId: match.id,
          walletTransactionId: walletTransaction.id,
          actor: 'user',
          actorId: user.id,
          triggerEvent: 'account_closure_match_cancelled',
          externalRefType: 'match',
          externalRefId: match.id,
          legs: [
            { ledgerAccount: 'contest_clearing', debit: match.wager_amount, credit: 0, transactionType: 'refund' },
            { ledgerAccount: 'user_account', userId: depositorId, debit: 0, credit: match.wager_amount, heldDelta: -match.wager_amount, transactionType: 'refund', totalWageredDelta: -match.wager_amount },
          ],
        });
      }

      await base44.asServiceRole.entities.Match.update(match.id, { status: 'cancelled' });
    }

    // (iv) Disburse any remaining undisputed balance, subject to compliance
    // holds. A withdrawal_hold means the balance stays put pending review.
    let payout = null;
    if (!user.withdrawal_hold) {
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
      const wallet = wallets[0];
      if (wallet && wallet.available_balance > 0) {
        payout = wallet.available_balance;

        const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: user.id,
          type: 'withdrawal',
          amount: payout,
          description: 'Account closure disbursement',
          status: 'pending',
        });

        // Double-entry: Debit User Available Balance, Credit Settlement Account.
        await postLedgerLegs(base44, {
          groupId: crypto.randomUUID(),
          walletTransactionId: walletTransaction.id,
          actor: 'user',
          actorId: user.id,
          triggerEvent: 'account_closure_disbursement',
          legs: [
            { ledgerAccount: 'user_account', userId: user.id, debit: payout, credit: 0, transactionType: 'withdrawal', totalWithdrawnDelta: payout },
            { ledgerAccount: 'settlement', debit: 0, credit: payout, transactionType: 'withdrawal' },
          ],
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