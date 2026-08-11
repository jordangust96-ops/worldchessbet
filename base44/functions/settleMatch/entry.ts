import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

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

    let match = await base44.asServiceRole.entities.Match.get(game.match_id);
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

    const fundingTransactions = await base44.asServiceRole.entities.WalletTransaction.filter({ match_id: match.id });

    // Settlement ownership is a short lease rather than a permanent lock. A
    // process can disappear before it writes any financial result, so a stale
    // lease is recoverable only when there is no payout/refund or settlement
    // ledger evidence. Once financial writing has begun, fail closed for manual
    // reconciliation instead of risking a duplicate payout.
    if (match.status === 'settling' || match.settlement_operation_id) {
      const leaseTimestamp = match.settlement_claimed_at || match.updated_date || match.created_date;
      const leaseAgeMs = Date.now() - new Date(leaseTimestamp || 0).getTime();
      if (!Number.isFinite(leaseAgeMs) || leaseAgeMs < 2 * 60 * 1000) {
        return Response.json({ error: 'settlement_in_progress' }, { status: 409 });
      }

      const settlementTransactions = fundingTransactions.filter((transaction) =>
        ['payout', 'wager_refund', 'service_fee_refund'].includes(transaction.type) &&
        transaction.status !== 'failed'
      );
      const ledgerEntries = await base44.asServiceRole.entities.LedgerEntry.filter({ match_id: match.id });
      const settlementLedgerEntries = ledgerEntries.filter((entry) =>
        ['match_settlement', 'match_settlement_draw', 'service_fee_refund'].includes(entry.trigger_event)
      );
      if (settlementTransactions.length || settlementLedgerEntries.length) {
        console.error(JSON.stringify({
          event: 'settlement_reconciliation_required',
          match_id: match.id,
          game_id: game.id,
          settlement_transaction_count: settlementTransactions.length,
          settlement_ledger_entry_count: settlementLedgerEntries.length,
        }));

        // A partial financial write must never be retried blindly. Surface one
        // admin-only, high-priority action instead; no enforcement, account, or
        // additional financial action is taken automatically.
        const existingFlags = await base44.asServiceRole.entities.IntegrityFlag.filter({
          match_id: match.id,
          flag_type: 'settlement_reconciliation_required',
        }, '-created_date', 5);
        if (!existingFlags.length) {
          await base44.asServiceRole.entities.IntegrityFlag.create({
            user_id: game.winner_id || match.player1_id || match.player2_id,
            match_id: match.id,
            flag_type: 'settlement_reconciliation_required',
            severity: 'high',
            status: 'open',
            description: 'Server settlement requires financial reconciliation before completion.',
            notes: `Automatic retry stopped to prevent a duplicate payout. Game ${game.id}; settlement transactions ${settlementTransactions.length}; settlement ledger entries ${settlementLedgerEntries.length}.`,
          });
        }
        return Response.json({ error: 'settlement_reconciliation_required' }, { status: 409 });
      }

      await base44.asServiceRole.entities.Match.update(match.id, {
        status: 'in_progress',
        settlement_operation_id: '',
      });
      match = await base44.asServiceRole.entities.Match.get(match.id);
    }

    if (!match.player1_deposited || !match.player2_deposited || !match.player1_certified || !match.player2_certified) {
      return Response.json({ error: 'settlement_funding_evidence_missing' }, { status: 409 });
    }
    const hasCompletedFunding = (userId, type) => fundingTransactions.some(
      (transaction) =>
        transaction.user_id === userId &&
        transaction.type === type &&
        transaction.status === 'completed' &&
        transaction.ledger_group_id &&
        transaction.processed_at
    );
    for (const playerId of [match.player1_id, match.player2_id]) {
      if (!playerId || !hasCompletedFunding(playerId, 'wager_lock') || !hasCompletedFunding(playerId, 'service_fee_charge')) {
        return Response.json({ error: 'settlement_ledger_evidence_missing' }, { status: 409 });
      }
    }

    const settlementOperationId = crypto.randomUUID();
    await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'settling',
      settlement_operation_id: settlementOperationId,
      settlement_claimed_at: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    match = await base44.asServiceRole.entities.Match.get(match.id);
    if (match.settlement_operation_id !== settlementOperationId) {
      return Response.json({ error: 'settlement_claim_lost' }, { status: 409 });
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

    const serviceFee = Number(match.platform_service_fee);
    if (!Number.isFinite(serviceFee) || serviceFee < 0) {
      return Response.json({ error: 'This contest is missing its disclosed Platform Service Fee.' }, { status: 409 });
    }

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
          status: 'pending',
        });

        // Double-entry: Debit Contest Reserve, Credit User Available Balance.
        await postLedgerLegs(base44, {
          groupId: crypto.randomUUID(),
          matchId: match.id,
          gameId: game.id,
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
          status: 'pending',
        });

        // Separate double-entry: Debit Suspense (never recognized), Credit
        // User Available Balance.
        await postLedgerLegs(base44, {
          groupId: crypto.randomUUID(),
          matchId: match.id,
          gameId: game.id,
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
        status: 'pending',
      });

      // Double-entry: Debit Contest Reserve for the full pot; Credit Winner
      // Available Balance the ENTIRE pot (100% — no percentage deducted).
      // Separately, both players' pending Platform Service Fees move from
      // Suspense to Platform Revenue, now that the contest has a valid,
      // decisive settlement. The loser's held stake is simply released — it
      // was already spent when it moved into the Contest Reserve at lock time.
      const approvedShortfall =
        match.settlement_reconciliation_operation_id && match.settlement_reconciliation_approved_by
          ? Number(match.settlement_reconciliation_shortfall || 0)
          : 0;
      if (!Number.isFinite(approvedShortfall) || approvedShortfall < 0 || approvedShortfall > pot) {
        return Response.json({ error: 'invalid_settlement_reconciliation_shortfall' }, { status: 409 });
      }

      const legs = [
        // Validate/debit protected reserve accounts before any user credit is applied.
        { ledgerAccount: 'contest_clearing', debit: pot - approvedShortfall, credit: 0, transactionType: 'match_settlement' },
      ];
      if (approvedShortfall > 0) {
        // Explicit contra-expense leg approved by an administrator. This keeps
        // the payout balanced without fabricating reserve funds or silently
        // reducing the winner's authoritative prize.
        legs.push({
          ledgerAccount: 'settlement_reconciliation_adjustment',
          debit: approvedShortfall,
          credit: 0,
          transactionType: 'settlement_reconciliation',
        });
      }
      legs.push(
        { ledgerAccount: 'suspense', debit: totalFee, credit: 0, transactionType: 'platform_fee' },
        { ledgerAccount: 'user_account', userId: winnerId, debit: 0, credit: pot, heldDelta: -(wagerAmount + serviceFee), transactionType: 'match_settlement', totalWonDelta: pot },
        { ledgerAccount: 'platform_revenue', debit: 0, credit: totalFee, transactionType: 'platform_fee' },
      );
      if (loserId) {
        legs.push({ ledgerAccount: 'user_account', userId: loserId, debit: 0, credit: 0, heldDelta: -(wagerAmount + serviceFee), transactionType: 'match_settlement' });
      }

      await postLedgerLegs(base44, {
        groupId: crypto.randomUUID(),
        matchId: match.id,
        gameId: game.id,
        walletTransactionId: walletTransaction.id,
        actor: 'system',
        triggerEvent: 'match_settlement',
        externalRefType: 'match',
        externalRefId: match.id,
        legs,
      });

      await Promise.all([
        updatePlayerStats(winnerId, 'win'),
        updatePlayerStats(loserId, 'loss'),
      ]);
    }

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'completed',
      settlement_operation_id: settlementOperationId,
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

    const contestRecord = await base44.asServiceRole.entities.ContestRecord.create({
      match_id: match.id,
      game_id: game.id,
      is_private: !!match.is_private,
      time_control: match.time_control,
      display_name: match.display_name || '',
      entry_amount: wagerAmount,
      contest_pool: wagerAmount * 2,
      platform_fee: settlementFee,
      platform_fee_per_player: serviceFee,
      platform_fee_schedule_version: match.platform_fee_schedule_version || '',
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

    await recordIntegrationEvent(base44, {
      eventType: 'contest.settled',
      aggregateType: 'contest_record',
      aggregateId: contestRecord.id,
      correlationId: match.id,
      idempotencyKey: `contest.settled:${match.id}`,
      actorType: 'system',
      userId: match.player1_id,
      counterpartyUserId: match.player2_id,
      matchId: match.id,
      gameId: game.id,
      status: updatedMatch.status,
      amount: settlementPayout,
      result: game.result,
      eventData: {
        contest_record_id: contestRecord.id,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        winner_id: settlementWinnerId,
        loser_id: settlementLoserId,
        outcome_type: game.end_reason || '',
        entry_amount: wagerAmount,
        contest_pool: wagerAmount * 2,
        platform_fee_total: settlementFee,
        wallet_transaction_ids: relatedWalletTransactions.map((transaction) => transaction.id),
        ledger_entry_ids: relatedLedgerEntries.map((entry) => entry.id),
        completed_at: updatedMatch.completed_at,
      },
    });

    // Integrity review and Stockfish screening are intentionally dispatched
    // by the independent Post-Settlement Integrity workflow after this Match
    // reaches completed. Keeping those non-financial jobs outside the
    // player-facing settlement workflow prevents external analysis latency
    // from extending the "Finalizing match result..." state.
    return Response.json({ match: updatedMatch });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});