import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Joining a match (public or private) runs through the exact same eligibility
// pipeline as hosting one (runContestEligibility), then places the joiner's
// Entry Hold and posts ledger entries BEFORE the Match is ever updated — so a
// failed eligibility check or a failed hold never results in a player being
// accepted into a match. Since the host's funds are already held at
// creation, once the joiner's hold succeeds the match can move straight to
// in_progress.

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

    if (match.status !== 'searching') {
      return Response.json({ error: 'This match is no longer available' }, { status: 400 });
    }
    if (match.player1_id === user.id) {
      return Response.json({ error: 'You cannot accept your own match' }, { status: 400 });
    }

    // 1. Eligibility — the single shared pipeline (identity, geolocation,
    // participation restrictions, available balance) also used by Host Match.
    // No Match state change and no financial action happens unless this passes.
    const eligibilityRes = await base44.functions.invoke('runContestEligibility', { entryAmount: match.wager_amount });
    if (eligibilityRes.data?.error || !eligibilityRes.data?.eligible) {
      return Response.json({ error: eligibilityRes.data?.reason || eligibilityRes.data?.error || 'You are not eligible to join this contest' }, { status: 403 });
    }

    // 2. Entry Hold — move the joiner's Entry Amount from Available to Held
    // and post the corresponding ledger entries.
    const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'wager_lock',
      amount: match.wager_amount,
      match_id: match.id,
      description: 'Entry amount reserved for joined match',
    });

    await postLedgerLegs(base44, {
      groupId: crypto.randomUUID(),
      matchId: match.id,
      walletTransactionId: walletTransaction.id,
      actor: 'user',
      actorId: user.id,
      triggerEvent: 'match_entry',
      externalRefType: 'match',
      externalRefId: match.id,
      legs: [
        { ledgerAccount: 'user_account', userId: user.id, debit: match.wager_amount, credit: 0, heldDelta: match.wager_amount, transactionType: 'match_entry', totalWageredDelta: match.wager_amount },
        { ledgerAccount: 'contest_clearing', debit: 0, credit: match.wager_amount, transactionType: 'match_entry' },
      ],
    });

    // 3. Accept Match — the host's Entry Hold was already placed at creation
    // (player1_deposited is always true by this point), so with the joiner
    // now funded too, the match can go straight into gameplay.
    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      player2_id: user.id,
      player2_deposited: true,
      status: 'in_progress',
    });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});