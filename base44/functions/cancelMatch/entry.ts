import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Cancels a pending (not yet in-progress) match and refunds any escrowed
// wager back to whichever player(s) already deposited. Runs server-side with
// the service role so wallet balances can never be set directly by a client.
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

    for (const depositorId of refundTargets) {
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: depositorId });
      if (wallets.length > 0) {
        const wallet = wallets[0];
        await base44.asServiceRole.entities.Wallet.update(wallet.id, {
          balance: wallet.balance + match.wager_amount,
          total_wagered: Math.max(0, (wallet.total_wagered || 0) - match.wager_amount),
        });
        await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: depositorId,
          type: 'wager_refund',
          amount: match.wager_amount,
          match_id: match.id,
          description: 'Reserved contest funds refunded — match cancelled',
          status: 'completed',
        });
      }
    }

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, { status: 'cancelled' });
    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});