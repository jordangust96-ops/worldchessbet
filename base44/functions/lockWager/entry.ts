import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Locks a player's wager into escrow for a match. Runs server-side with the
// service role so the wallet balance deduction is always computed from the
// server's own wallet record — a client can never set its own balance.
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

    const alreadyDeposited = isP1 ? match.player1_deposited : match.player2_deposited;
    if (alreadyDeposited) {
      return Response.json({ error: 'You have already deposited for this match' }, { status: 400 });
    }
    if (match.status === 'cancelled' || match.status === 'completed' || match.status === 'in_progress') {
      return Response.json({ error: 'This match is no longer accepting deposits' }, { status: 400 });
    }

    const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    const wallet = wallets[0];
    if (!wallet || wallet.balance < match.wager_amount) {
      return Response.json({ error: 'Insufficient balance for this wager' }, { status: 400 });
    }

    await base44.asServiceRole.entities.Wallet.update(wallet.id, {
      balance: wallet.balance - match.wager_amount,
      total_wagered: (wallet.total_wagered || 0) + match.wager_amount,
    });
    await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'wager_lock',
      amount: match.wager_amount,
      match_id: match.id,
      description: 'Wager locked for match',
    });

    const opponentDeposited = isP1 ? match.player2_deposited : match.player1_deposited;
    const updates = isP1 ? { player1_deposited: true } : { player2_deposited: true };
    updates.status = opponentDeposited ? 'in_progress' : 'deposited';

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, updates);
    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});