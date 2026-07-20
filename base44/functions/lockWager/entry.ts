import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Reserves a player's Entry Amount into escrow during the shared Preparing
// Match phase. Requires that player to have already certified Fair Play.
// Runs server-side with the service role so the wallet balance deduction is
// always computed from the Internal Ledger — a client can never set its own
// balance. Once both players have certified AND reserved funds, this
// function is also the trigger that creates/loads the Game and takes the
// match live.
//
// Financial model: the Contest Entry Amount and the Platform Service Fee
// (10% of the Entry Amount) are two independent, separately-disclosed
// charges. The Entry Amount moves into the Contest Reserve
// ('contest_clearing') where it stays untouched until settlement. The
// Service Fee moves into 'suspense' — pending, not yet recognized revenue —
// and is only ever promoted to 'platform_revenue' once the match settles
// with a decisive result. Each charge gets its own WalletTransaction and its
// own balanced ledger group so the two remain independently auditable.
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

    // Only Verified accounts may enter paid contests (Provisional/Suspended/Closed cannot).
    if (user.account_state !== 'verified') {
      return Response.json({ error: 'Your account must be verified before you can enter a paid contest' }, { status: 403 });
    }

    const {
      matchId,
      browserGeoPermission,
      browserLatitude,
      browserLongitude,
      browserAccuracyMeters,
      deviceFingerprintHash,
    } = await req.json();

    // Re-verify jurisdiction immediately before payment authorization — never
    // rely on a stale client-side or earlier-in-flow check.
    const jurisdictionRes = await base44.functions.invoke('getCurrentJurisdiction', {
      triggerEvent: 'lock_wager',
      relatedEntityType: 'match',
      relatedEntityId: matchId || '',
      browserGeoPermission,
      browserLatitude,
      browserLongitude,
      browserAccuracyMeters,
      deviceFingerprintHash,
    });
    if (jurisdictionRes.data?.error || jurisdictionRes.data?.status !== 'approved') {
      return Response.json({ error: jurisdictionRes.data?.reason || 'You are not currently eligible to fund a contest entry from your location.' }, { status: 403 });
    }

    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    if (match.status !== 'preparing' && match.status !== 'both_ready') {
      return Response.json({ error: 'This match is not currently accepting entry reservations' }, { status: 400 });
    }

    const alreadyDeposited = isP1 ? match.player1_deposited : match.player2_deposited;
    if (alreadyDeposited) {
      return Response.json({ error: 'You have already reserved your entry amount' }, { status: 400 });
    }

    const certified = isP1 ? match.player1_certified : match.player2_certified;
    if (!certified) {
      return Response.json({ error: 'Certify Fair Play before reserving your entry amount' }, { status: 400 });
    }

    const serviceFee = Math.round(match.wager_amount * SERVICE_FEE_RATE * 100) / 100;
    const totalCharge = match.wager_amount + serviceFee;

    const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    const wallet = wallets[0];
    if (!wallet || wallet.available_balance < totalCharge) {
      return Response.json({ error: 'Insufficient balance for this entry amount and platform service fee' }, { status: 400 });
    }

    const entryTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'wager_lock',
      amount: match.wager_amount,
      match_id: match.id,
      description: 'Contest entry amount reserved for match',
    });

    // Double-entry: Debit User Available Balance, Credit Contest Reserve.
    // The debited amount is simultaneously moved into the user's held balance.
    await postLedgerLegs(base44, {
      groupId: crypto.randomUUID(),
      matchId: match.id,
      walletTransactionId: entryTransaction.id,
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

    const feeTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'service_fee_charge',
      amount: serviceFee,
      match_id: match.id,
      description: 'Platform service fee charged for match',
    });

    // Separate double-entry, in its own balanced group: Debit User Available
    // Balance, Credit Suspense (pending — not yet recognized as revenue until
    // the match settles with a decisive result).
    await postLedgerLegs(base44, {
      groupId: crypto.randomUUID(),
      matchId: match.id,
      walletTransactionId: feeTransaction.id,
      actor: 'user',
      actorId: user.id,
      triggerEvent: 'service_fee_charge',
      externalRefType: 'match',
      externalRefId: match.id,
      legs: [
        { ledgerAccount: 'user_account', userId: user.id, debit: serviceFee, credit: 0, heldDelta: serviceFee, transactionType: 'platform_fee' },
        { ledgerAccount: 'suspense', debit: 0, credit: serviceFee, transactionType: 'platform_fee' },
      ],
    });

    const depositUpdates = isP1 ? { player1_deposited: true } : { player2_deposited: true };
    let updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, depositUpdates);

    // Only when BOTH players have certified Fair Play AND successfully
    // reserved funds does the match go live — never earlier. getOrCreateGame
    // is idempotent, so even if certifyFairPlay's own readiness check fires
    // this same transition concurrently, only one Game is ever created.
    const bothCertified = updatedMatch.player1_certified && updatedMatch.player2_certified;
    const bothDeposited = updatedMatch.player1_deposited && updatedMatch.player2_deposited;
    if (bothCertified && bothDeposited) {
      await base44.asServiceRole.entities.Match.update(match.id, { status: 'both_ready' });
      await base44.functions.invoke('getOrCreateGame', { matchId: match.id });
      updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, { status: 'in_progress' });
    }

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});