import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Cancels a pending (not yet in-progress) match and refunds any escrowed
// Contest Entry Amount AND Platform Service Fee back to whichever player(s)
// already deposited. Runs server-side with the service role so wallet
// balances can never be set directly by a client.
const SERVICE_FEE_RATE = 0.1;

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

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    if (match.status === 'cancelled' || match.status === 'completed' || match.status === 'in_progress') {
      return Response.json({ error: 'This match can no longer be cancelled' }, { status: 400 });
    }

    const refundTargets = [];
    if (match.player1_deposited) refundTargets.push(match.player1_id);
    if (match.player2_deposited) refundTargets.push(match.player2_id);

    const serviceFee = Math.round(match.wager_amount * SERVICE_FEE_RATE * 100) / 100;

    for (const depositorId of refundTargets) {
      const entryTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
        user_id: depositorId,
        type: 'wager_refund',
        amount: match.wager_amount,
        match_id: match.id,
        description: 'Reserved contest entry amount refunded — match cancelled',
        status: 'completed',
      });

      // Double-entry: Debit Contest Reserve, Credit User Available Balance;
      // releases the corresponding held amount back to available.
      await postLedgerLegs(base44, {
        groupId: crypto.randomUUID(),
        matchId: match.id,
        walletTransactionId: entryTransaction.id,
        actor: 'user',
        actorId: user.id,
        triggerEvent: 'match_cancelled',
        externalRefType: 'match',
        externalRefId: match.id,
        legs: [
          { ledgerAccount: 'contest_clearing', debit: match.wager_amount, credit: 0, transactionType: 'refund' },
          { ledgerAccount: 'user_account', userId: depositorId, debit: 0, credit: match.wager_amount, heldDelta: -match.wager_amount, transactionType: 'refund', totalWageredDelta: -match.wager_amount },
        ],
      });

      const feeTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
        user_id: depositorId,
        type: 'service_fee_refund',
        amount: serviceFee,
        match_id: match.id,
        description: 'Platform service fee refunded — match cancelled',
        status: 'completed',
      });

      // Separate double-entry: Debit Suspense (never recognized), Credit
      // User Available Balance.
      await postLedgerLegs(base44, {
        groupId: crypto.randomUUID(),
        matchId: match.id,
        walletTransactionId: feeTransaction.id,
        actor: 'user',
        actorId: user.id,
        triggerEvent: 'service_fee_refund',
        externalRefType: 'match',
        externalRefId: match.id,
        legs: [
          { ledgerAccount: 'suspense', debit: serviceFee, credit: 0, transactionType: 'refund' },
          { ledgerAccount: 'user_account', userId: depositorId, debit: 0, credit: serviceFee, heldDelta: -serviceFee, transactionType: 'refund' },
        ],
      });
    }

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, { status: 'cancelled' });
    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});