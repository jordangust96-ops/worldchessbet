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

    // This function is invoked by the MatchSettlement workflow (a trusted,
    // system-level call with no end-user token) as well as potentially being
    // reachable directly. When a real end-user token IS present, require the
    // caller to actually be one of the two match players — this blocks any
    // other authenticated user from forcing settlement of a match they're not
    // part of, while leaving the trusted workflow trigger unaffected.
    const user = await base44.auth.me();
    if (user && user.id !== match.player1_id && user.id !== match.player2_id) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    // Idempotency guard — settlement must apply exactly once per match, even if
    // this function is retried or the trigger fires more than once.
    if (match.status === 'completed') {
      return Response.json({ alreadySettled: true, match });
    }

    const wagerAmount = match.wager_amount || 0;
    const isDraw = game.result === 'draw' || !game.winner_id;

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