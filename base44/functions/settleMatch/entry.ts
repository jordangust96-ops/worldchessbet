import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Settles wallet balances once a Game has reached a terminal state (checkmate,
// resignation, draw, or timeout — all already decided by existing gameplay
// functions). This function does not decide the winner or recompute the payout
// formula; it only applies the already-established 90% payout / refund rules
// via the Internal Ledger and marks the Match as completed, exactly once.

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
    const { gameId } = await req.json();
    if (!gameId) return Response.json({ error: 'gameId is required' }, { status: 400 });

    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });
    if (game.status !== 'completed') {
      return Response.json({ error: 'Game is not completed yet' }, { status: 400 });
    }

    const match = await base44.asServiceRole.entities.Match.get(game.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    // This function only ever applies the already-decided outcome of a
    // completed Game (checked above) — it never trusts caller-supplied
    // results — and the idempotency guard below ensures it can run at most
    // once per match. That makes it safe to call regardless of who/what
    // triggers it (the MatchSettlement workflow, or either player directly),
    // so no caller-identity check is needed here.

    // Idempotency guard — settlement must apply exactly once per match, even if
    // this function is retried or the trigger fires more than once.
    if (match.status === 'completed') {
      return Response.json({ alreadySettled: true, match });
    }

    const wagerAmount = match.wager_amount || 0;
    const isDraw = game.result === 'draw' || !game.winner_id;

    // Updates the player-facing stats cache on the User entity
    // (games_played/games_won/games_lost/win_percentage) so the marketplace
    // can read stored values instead of recomputing them on every load.
    const updatePlayerStats = async (playerId, outcome) => {
      if (!playerId) return;
      const player = await base44.asServiceRole.entities.User.get(playerId);
      const gamesPlayed = (player.games_played || 0) + 1;
      const gamesWon = (player.games_won || 0) + (outcome === 'win' ? 1 : 0);
      const gamesLost = (player.games_lost || 0) + (outcome === 'loss' ? 1 : 0);
      const winPercentage = Math.round((gamesWon / gamesPlayed) * 100);
      await base44.asServiceRole.entities.User.update(playerId, {
        games_played: gamesPlayed,
        games_won: gamesWon,
        games_lost: gamesLost,
        win_percentage: winPercentage,
      });
    };

    if (isDraw) {
      // Refund both players' escrowed wager — no winner, no loser.
      for (const playerId of [match.player1_id, match.player2_id].filter(Boolean)) {
        const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: playerId,
          type: 'wager_refund',
          amount: wagerAmount,
          match_id: match.id,
          description: 'Entry amount refunded — match ended in a draw',
          status: 'completed',
        });

        // Double-entry: Debit Contest Clearing, Credit User Available Balance.
        await postLedgerLegs(base44, {
          groupId: crypto.randomUUID(),
          matchId: match.id,
          walletTransactionId: walletTransaction.id,
          actor: 'system',
          triggerEvent: 'match_settlement_draw',
          externalRefType: 'match',
          externalRefId: match.id,
          legs: [
            { ledgerAccount: 'contest_clearing', debit: wagerAmount, credit: 0, transactionType: 'refund' },
            { ledgerAccount: 'user_account', userId: playerId, debit: 0, credit: wagerAmount, heldDelta: -wagerAmount, transactionType: 'refund' },
          ],
        });

        await updatePlayerStats(playerId, 'draw');
      }
    } else {
      const winnerId = game.winner_id;
      const loserId = [match.player1_id, match.player2_id].filter(Boolean).find((id) => id !== winnerId);
      const pot = wagerAmount * 2;
      const payout = pot * 0.9;
      const fee = pot - payout;

      const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
        user_id: winnerId,
        type: 'payout',
        amount: payout,
        match_id: match.id,
        description: 'Match winnings payout',
        status: 'completed',
      });

      // Double-entry: Debit Contest Clearing for the full pot; Credit Winner
      // Available Balance (90%) and Credit Platform Revenue (10% fee). The
      // loser's held stake is simply released — it was already spent when
      // it moved into Contest Clearing at lock time.
      const legs = [
        { ledgerAccount: 'contest_clearing', debit: pot, credit: 0, transactionType: 'match_settlement' },
        { ledgerAccount: 'user_account', userId: winnerId, debit: 0, credit: payout, heldDelta: -wagerAmount, transactionType: 'match_settlement', totalWonDelta: payout },
        { ledgerAccount: 'platform_revenue', debit: 0, credit: fee, transactionType: 'platform_fee' },
      ];
      if (loserId) {
        legs.push({ ledgerAccount: 'user_account', userId: loserId, debit: 0, credit: 0, heldDelta: -wagerAmount, transactionType: 'match_settlement' });
      }

      await postLedgerLegs(base44, {
        groupId: crypto.randomUUID(),
        matchId: match.id,
        walletTransactionId: walletTransaction.id,
        actor: 'system',
        triggerEvent: 'match_settlement',
        externalRefType: 'match',
        externalRefId: match.id,
        legs,
      });

      await updatePlayerStats(winnerId, 'win');
      await updatePlayerStats(loserId, 'loss');
    }

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'completed',
      winner_id: game.winner_id || '',
      result: game.result,
      completed_at: game.completed_at || new Date().toISOString(),
    });

    // Fire the lightweight integrity check after settlement so it never
    // delays or blocks the contest's own settlement/response.
    await base44.asServiceRole.functions
      .invoke('runIntegrityCheck', { matchId: match.id, gameId: game.id })
      .catch(() => {});

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});