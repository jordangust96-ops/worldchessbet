import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Self-service account closure. Runs server-side with the service role so
// contest cancellations, refunds, and the closure payout are always computed
// via the Internal Ledger — never trusted from the client.

// Posts a balanced set of Internal Ledger entries and updates the derived
// Wallet/SystemLedgerAccount balances accordingly. Duplicated (not imported)
// in every function that posts to the ledger — backend functions deploy
// independently and cannot share local modules.
async function postLedgerLegs(base44, { groupId, matchId, walletTransactionId, actor, actorId, triggerEvent, externalRefType, externalRefId, legs }) {
  const totalDebit = legs.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = legs.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    throw new Error(`Unbalanced ledger legs: debit=${totalDebit} credit=${totalCredit}`);
  }
  const entries = [];
  for (const leg of legs) {
    if (leg.ledgerAccount === 'user_account') {
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: leg.userId });
      let wallet = wallets[0];
      if (!wallet) {
        wallet = await base44.asServiceRole.entities.Wallet.create({
          user_id: leg.userId, balance: 0, available_balance: 0, held_balance: 0, total_balance: 0,
          total_wagered: 0, total_won: 0, total_deposited: 0, total_withdrawn: 0,
        });
      }
      const newAvailable = (wallet.available_balance || 0) - (leg.debit || 0) + (leg.credit || 0);
      const newHeld = (wallet.held_balance || 0) + (leg.heldDelta || 0);
      const newTotal = newAvailable + newHeld;
      await base44.asServiceRole.entities.Wallet.update(wallet.id, {
        available_balance: newAvailable,
        held_balance: newHeld,
        total_balance: newTotal,
        balance: newAvailable,
        total_wagered: (wallet.total_wagered || 0) + (leg.totalWageredDelta || 0),
        total_won: (wallet.total_won || 0) + (leg.totalWonDelta || 0),
        total_deposited: (wallet.total_deposited || 0) + (leg.totalDepositedDelta || 0),
        total_withdrawn: (wallet.total_withdrawn || 0) + (leg.totalWithdrawnDelta || 0),
      });
      entries.push({
        user_id: leg.userId, match_id: matchId || '', wallet_transaction_id: walletTransactionId || '',
        ledger_account: 'user_account', transaction_type: leg.transactionType,
        debit_amount: leg.debit || 0, credit_amount: leg.credit || 0,
        resulting_available_balance: newAvailable, resulting_held_balance: newHeld, resulting_total_balance: newTotal,
        initiating_actor: actor, initiating_actor_id: actorId || '', trigger_event: triggerEvent,
        external_reference_type: externalRefType || 'none', external_reference_id: externalRefId || '',
        ledger_group_id: groupId,
      });
    } else {
      const accounts = await base44.asServiceRole.entities.SystemLedgerAccount.filter({ account_name: leg.ledgerAccount });
      let acct = accounts[0];
      if (!acct) acct = await base44.asServiceRole.entities.SystemLedgerAccount.create({ account_name: leg.ledgerAccount, balance: 0 });
      const newBalance = (acct.balance || 0) - (leg.debit || 0) + (leg.credit || 0);
      await base44.asServiceRole.entities.SystemLedgerAccount.update(acct.id, { balance: newBalance });
      entries.push({
        match_id: matchId || '', wallet_transaction_id: walletTransactionId || '',
        ledger_account: leg.ledgerAccount, transaction_type: leg.transactionType,
        debit_amount: leg.debit || 0, credit_amount: leg.credit || 0,
        resulting_total_balance: newBalance,
        initiating_actor: actor, initiating_actor_id: actorId || '', trigger_event: triggerEvent,
        external_reference_type: externalRefType || 'none', external_reference_id: externalRefId || '',
        ledger_group_id: groupId,
      });
    }
  }
  await base44.asServiceRole.entities.LedgerEntry.bulkCreate(entries);
  return entries;
}

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