import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Server-authoritative deposit handler. The client only ever sends the
// requested amount — the resulting balance is always computed here from the
// Internal Ledger, so a client can never dictate its own balance directly.
const MAX_DEPOSIT_AMOUNT = 10000;

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

    const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'deposit',
      amount: requestedAmount,
      description: 'Account funded',
    });

    // Double-entry: Debit Settlement Account, Credit User Available Balance.
    await postLedgerLegs(base44, {
      groupId: crypto.randomUUID(),
      walletTransactionId: walletTransaction.id,
      actor: 'user',
      actorId: user.id,
      triggerEvent: 'deposit',
      legs: [
        { ledgerAccount: 'settlement', debit: requestedAmount, credit: 0, transactionType: 'deposit' },
        { ledgerAccount: 'user_account', userId: user.id, debit: 0, credit: requestedAmount, transactionType: 'deposit', totalDepositedDelta: requestedAmount },
      ],
    });

    const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    return Response.json({ eligible: true, wallet: wallets[0] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});