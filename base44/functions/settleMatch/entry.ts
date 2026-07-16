import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Settles wallet balances once a Game has reached a terminal state (checkmate,
// resignation, draw, or timeout — all already decided by existing gameplay
// functions). This function does not decide the winner; it only applies the
// financial outcome via the Internal Ledger and marks the Match as
// completed, exactly once.
//
// Financial model: the Contest Entry Amount and the Platform Service Fee
// (charged separately at lock time, see lockWager) are settled independently.
// On a decisive result, the winner receives 100% of the combined Contest
// Entry Amounts (the full Contest Reserve) — no percentage is ever deducted
// from the pot — and both players' pending Service Fees are simultaneously
// recognized as Platform Revenue. On a draw, both the Entry Amount and the
// Service Fee are fully refunded to each player; no Platform Revenue is
// recognized.
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
    const { gameId } = await req.json();
    if (!gameId) return Response.json({ error: 'gameId is required' }, { status: 400 });

    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });
    if (game.status !== 'completed') {
      return Response.json({ error: 'Game is not completed yet' }, { status: 400 });
    }

    const match = await base44.asServiceRole.entities.Match.get(game.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    // Administrative pre-settlement hold — set only via a Dispute Case
    // (manageDisputeCase). While active, settlement is paused entirely and
    // both players' funds stay in the Contest Clearing Account. Releasing
    // the hold re-invokes this same function to resume settlement.
    if (match.settlement_hold) {
      return Response.json({ held: true, match });
    }

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
    // Hoisted so the Contest Record created below can reference whichever
    // outcome branch actually ran.
    let settlementWinnerId = '';
    let settlementLoserId = '';
    let settlementPayout = 0;
    let settlementFee = 0;

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

    const serviceFee = Math.round(wagerAmount * SERVICE_FEE_RATE * 100) / 100;

    if (isDraw) {
      // Refund both players' escrowed Entry Amount AND their Platform Service
      // Fee — no winner, no loser, no Platform Revenue recognized.
      for (const playerId of [match.player1_id, match.player2_id].filter(Boolean)) {
        const entryTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: playerId,
          type: 'wager_refund',
          amount: wagerAmount,
          match_id: match.id,
          description: 'Contest entry amount refunded — match ended in a draw',
          status: 'completed',
        });

        // Double-entry: Debit Contest Reserve, Credit User Available Balance.
        await postLedgerLegs(base44, {
          groupId: crypto.randomUUID(),
          matchId: match.id,
          walletTransactionId: entryTransaction.id,
          actor: 'system',
          triggerEvent: 'match_settlement_draw',
          externalRefType: 'match',
          externalRefId: match.id,
          legs: [
            { ledgerAccount: 'contest_clearing', debit: wagerAmount, credit: 0, transactionType: 'refund' },
            { ledgerAccount: 'user_account', userId: playerId, debit: 0, credit: wagerAmount, heldDelta: -wagerAmount, transactionType: 'refund' },
          ],
        });

        const feeTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: playerId,
          type: 'service_fee_refund',
          amount: serviceFee,
          match_id: match.id,
          description: 'Platform service fee refunded — match ended in a draw',
          status: 'completed',
        });

        // Separate double-entry: Debit Suspense (never recognized), Credit
        // User Available Balance.
        await postLedgerLegs(base44, {
          groupId: crypto.randomUUID(),
          matchId: match.id,
          walletTransactionId: feeTransaction.id,
          actor: 'system',
          triggerEvent: 'service_fee_refund',
          externalRefType: 'match',
          externalRefId: match.id,
          legs: [
            { ledgerAccount: 'suspense', debit: serviceFee, credit: 0, transactionType: 'refund' },
            { ledgerAccount: 'user_account', userId: playerId, debit: 0, credit: serviceFee, heldDelta: -serviceFee, transactionType: 'refund' },
          ],
        });

        await updatePlayerStats(playerId, 'draw');
      }
    } else {
      const winnerId = game.winner_id;
      const loserId = [match.player1_id, match.player2_id].filter(Boolean).find((id) => id !== winnerId);
      const pot = wagerAmount * 2; // Contest Reserve — Entry Amounts only, never the fee.
      const totalFee = serviceFee * 2;
      settlementWinnerId = winnerId || '';
      settlementLoserId = loserId || '';
      settlementPayout = pot;
      settlementFee = totalFee;

      const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
        user_id: winnerId,
        type: 'payout',
        amount: pot,
        match_id: match.id,
        description: 'Contest winnings payout — full combined entry amounts',
        status: 'completed',
      });

      // Double-entry: Debit Contest Reserve for the full pot; Credit Winner
      // Available Balance the ENTIRE pot (100% — no percentage deducted).
      // Separately, both players' pending Platform Service Fees move from
      // Suspense to Platform Revenue, now that the contest has a valid,
      // decisive settlement. The loser's held stake is simply released — it
      // was already spent when it moved into the Contest Reserve at lock time.
      const legs = [
        { ledgerAccount: 'contest_clearing', debit: pot, credit: 0, transactionType: 'match_settlement' },
        { ledgerAccount: 'user_account', userId: winnerId, debit: 0, credit: pot, heldDelta: -(wagerAmount + serviceFee), transactionType: 'match_settlement', totalWonDelta: pot },
        { ledgerAccount: 'suspense', debit: totalFee, credit: 0, transactionType: 'platform_fee' },
        { ledgerAccount: 'platform_revenue', debit: 0, credit: totalFee, transactionType: 'platform_fee' },
      ];
      if (loserId) {
        legs.push({ ledgerAccount: 'user_account', userId: loserId, debit: 0, credit: 0, heldDelta: -(wagerAmount + serviceFee), transactionType: 'match_settlement' });
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

    // Immutable Contest Record — ChessBet's permanent system of record for this
    // contest. Created exactly once, only after the outcome is determined,
    // financial settlement has completed, ledger entries are written, and
    // player statistics are updated (all above). It is never edited after
    // this; disputes/investigation notes are appended separately via
    // ContestRecordAnnotation. The idempotency guard above (match.status ===
    // 'completed' short-circuit) ensures this create can only ever run once
    // per match, so no additional duplicate-check is needed here.
    const [relatedWalletTransactions, relatedLedgerEntries, whiteUser, blackUser] = await Promise.all([
      base44.asServiceRole.entities.WalletTransaction.filter({ match_id: match.id }),
      base44.asServiceRole.entities.LedgerEntry.filter({ match_id: match.id }),
      match.player1_id ? base44.asServiceRole.entities.User.get(match.player1_id) : null,
      match.player2_id ? base44.asServiceRole.entities.User.get(match.player2_id) : null,
    ]);

    await base44.asServiceRole.entities.ContestRecord.create({
      match_id: match.id,
      game_id: game.id,
      is_private: !!match.is_private,
      time_control: match.time_control,
      display_name: match.display_name || '',
      entry_amount: wagerAmount,
      contest_pool: wagerAmount * 2,
      platform_fee: settlementFee,
      contest_start_at: game.started_at || match.created_date,
      contest_end_at: game.completed_at || updatedMatch.completed_at,
      white_player_id: match.player1_id || '',
      black_player_id: match.player2_id || '',
      white_username: whiteUser?.full_name || '',
      black_username: blackUser?.full_name || '',
      pgn: game.pgn || '',
      move_log: game.move_log || [],
      final_fen: game.fen || '',
      total_moves: (game.move_log || []).length,
      winner_id: settlementWinnerId,
      loser_id: settlementLoserId,
      outcome_type: game.end_reason || '',
      winner_payout: settlementPayout,
      settlement_timestamp: new Date().toISOString(),
      ledger_entry_ids: relatedLedgerEntries.map((e) => e.id),
      wallet_transaction_ids: relatedWalletTransactions.map((t) => t.id),
      integrity_investigation_flag: false,
      dispute_status: 'none',
      // Disconnect/reconnect audit trail, snapshotted from the Game at
      // settlement time \u2014 internal-only, never shown to users, and never
      // itself a factor in the outcome (outcome_type/winner_id above already
      // reflect the chess-clock-authoritative result).
      white_disconnected_at: game.white_disconnected_at || '',
      white_reconnected_at: game.white_reconnected_at || '',
      white_total_disconnected_ms: game.white_total_disconnected_ms || 0,
      black_disconnected_at: game.black_disconnected_at || '',
      black_reconnected_at: game.black_reconnected_at || '',
      black_total_disconnected_ms: game.black_total_disconnected_ms || 0,
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