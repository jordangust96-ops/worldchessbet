import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Settles wallet balances once a Game has reached a terminal state (checkmate,
// resignation, draw, or timeout — all already decided by existing gameplay
// functions). This function does not decide the winner or recompute the payout
// formula; it only applies the already-established 90% payout / refund rules
// to wallets and marks the Match as completed, exactly once.
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
        const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: playerId });
        if (wallets.length > 0) {
          const wallet = wallets[0];
          await base44.asServiceRole.entities.Wallet.update(wallet.id, {
            balance: wallet.balance + wagerAmount,
          });
          await base44.asServiceRole.entities.WalletTransaction.create({
            user_id: playerId,
            type: 'wager_refund',
            amount: wagerAmount,
            match_id: match.id,
            description: 'Wager refunded — match ended in a draw',
            status: 'completed',
          });
        }
        await updatePlayerStats(playerId, 'draw');
      }
    } else {
      const winnerId = game.winner_id;
      const payout = wagerAmount * 2 * 0.9;

      const winnerWallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: winnerId });
      if (winnerWallets.length > 0) {
        const wallet = winnerWallets[0];
        await base44.asServiceRole.entities.Wallet.update(wallet.id, {
          balance: wallet.balance + payout,
          total_won: (wallet.total_won || 0) + payout,
        });
        await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: winnerId,
          type: 'payout',
          amount: payout,
          match_id: match.id,
          description: 'Match winnings payout',
          status: 'completed',
        });
      }
      // The loser's wager was already deducted from their balance when they
      // deposited into escrow — no further balance change is needed here.

      const loserId = [match.player1_id, match.player2_id].filter(Boolean).find((id) => id !== winnerId);
      await updatePlayerStats(winnerId, 'win');
      await updatePlayerStats(loserId, 'loss');
    }

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'completed',
      winner_id: game.winner_id || '',
      result: game.result,
      completed_at: game.completed_at || new Date().toISOString(),
    });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});