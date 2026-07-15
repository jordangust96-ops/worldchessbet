import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Creates a new challenge (public or private) with the host's Entry Amount
// already reserved. The Match is only ever created — and therefore only ever
// becomes visible in the marketplace or joinable via invite link — after the
// host's funds have been successfully moved from Available Balance to Held
// Balance and recorded in the Internal Ledger. If the hold succeeds but the
// Match record fails to save, the hold is automatically rolled back so no
// orphaned hold is ever left behind.

const VALID_TIME_CONTROLS = new Set(['blitz', 'rapid', 'classical']);

// Posts a balanced set of Internal Ledger entries and updates the derived
// Wallet/SystemLedgerAccount balances accordingly. Duplicated (not imported)
// in every function that posts to the ledger — backend functions deploy
// independently and cannot share local modules. Returns the created
// LedgerEntry records (with ids) so callers can patch match_id later.
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
  return await base44.asServiceRole.entities.LedgerEntry.bulkCreate(entries);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { wagerAmount, timeControl, displayName, isPrivate } = await req.json();
    const wager = Number(wagerAmount);
    if (!Number.isFinite(wager) || wager <= 0) {
      return Response.json({ error: 'Invalid entry amount' }, { status: 400 });
    }
    if (!VALID_TIME_CONTROLS.has(timeControl)) {
      return Response.json({ error: 'Invalid time control' }, { status: 400 });
    }

    // 1. Eligibility — the single shared pipeline (identity, geolocation,
    // participation restrictions, available balance) also used by Join Match.
    const eligibilityRes = await base44.functions.invoke('runContestEligibility', { entryAmount: wager });
    if (eligibilityRes.data?.error || !eligibilityRes.data?.eligible) {
      return Response.json({ error: eligibilityRes.data?.reason || eligibilityRes.data?.error || 'You are not eligible to create this contest' }, { status: 403 });
    }

    // 2. Entry Hold — move the Entry Amount from Available to Held and post
    // the corresponding ledger entries BEFORE the Match exists. match_id is
    // patched onto these records once the Match is successfully created.
    const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'wager_lock',
      amount: wager,
      description: 'Entry amount reserved for hosted challenge',
    });

    const ledgerGroupId = crypto.randomUUID();
    const holdEntries = await postLedgerLegs(base44, {
      groupId: ledgerGroupId,
      walletTransactionId: walletTransaction.id,
      actor: 'user',
      actorId: user.id,
      triggerEvent: 'match_entry',
      legs: [
        { ledgerAccount: 'user_account', userId: user.id, debit: wager, credit: 0, heldDelta: wager, transactionType: 'match_entry', totalWageredDelta: wager },
        { ledgerAccount: 'contest_clearing', debit: 0, credit: wager, transactionType: 'match_entry' },
      ],
    });

    // 4. Create the Match — only now, with funds already held, does it
    // become eligible to appear in the marketplace or via invite link.
    let match;
    try {
      match = await base44.asServiceRole.entities.Match.create({
        player1_id: user.id,
        wager_amount: wager,
        time_control: timeControl,
        display_name: displayName,
        status: 'searching',
        is_private: !!isPrivate,
        player1_deposited: true,
        ...(isPrivate ? { invite_code: crypto.randomUUID() } : {}),
      });
    } catch (matchError) {
      // Rollback: release the hold exactly as it was placed, so the user is
      // restored to the exact financial state they were in beforehand.
      await postLedgerLegs(base44, {
        groupId: crypto.randomUUID(),
        walletTransactionId: walletTransaction.id,
        actor: 'system',
        triggerEvent: 'match_creation_rollback',
        legs: [
          { ledgerAccount: 'contest_clearing', debit: wager, credit: 0, transactionType: 'reversal' },
          { ledgerAccount: 'user_account', userId: user.id, debit: 0, credit: wager, heldDelta: -wager, transactionType: 'reversal', totalWageredDelta: -wager },
        ],
      });
      await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, {
        status: 'failed',
        description: 'Entry amount reservation rolled back — match creation failed',
      });
      throw new Error('Failed to create the match; your reserved funds have been released. Please try again.');
    }

    // Patch the hold's WalletTransaction/LedgerEntry records with the now-known match id.
    await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, { match_id: match.id });
    await base44.asServiceRole.entities.LedgerEntry.bulkUpdate(
      holdEntries.map((e) => ({ id: e.id, match_id: match.id }))
    );

    return Response.json({ match });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});