import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

// Cancels a pending (not yet in-progress) match and refunds any escrowed
// Contest Entry Amount AND Platform Service Fee back to whichever player(s)
// already deposited. Runs server-side with the service role so wallet
// balances can never be set directly by a client.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    let match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    if (match.status === 'cancelled' || match.status === 'completed' || match.status === 'in_progress' || match.status === 'settling') {
      return Response.json({ error: 'This match can no longer be cancelled' }, { status: 400 });
    }
    if (match.status === 'cancelling' || match.cancellation_operation_id) {
      return Response.json({ error: 'cancellation_in_progress' }, { status: 409 });
    }

    const cancellationOperationId = crypto.randomUUID();
    await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'cancelling',
      cancellation_operation_id: cancellationOperationId,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    match = await base44.asServiceRole.entities.Match.get(match.id);
    if (match.cancellation_operation_id !== cancellationOperationId) {
      return Response.json({ error: 'cancellation_claim_lost' }, { status: 409 });
    }

    const refundTargets = [];
    if (match.player1_deposited) refundTargets.push(match.player1_id);
    if (match.player2_deposited) refundTargets.push(match.player2_id);

    const serviceFee = Number(match.platform_service_fee);
    if (!Number.isFinite(serviceFee) || serviceFee < 0) {
      return Response.json({ error: 'This contest is missing its disclosed Platform Service Fee.' }, { status: 409 });
    }

    for (const depositorId of refundTargets) {
      const entryTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
        launch_epoch: 2,
        user_id: depositorId,
        type: 'wager_refund',
        amount: match.wager_amount,
        match_id: match.id,
        description: 'Reserved contest entry amount refunded — match cancelled',
        status: 'completed',
      });

      // Double-entry: Debit Contest Reserve, Credit User Available Balance;
      // releases the corresponding held amount back to available.
      await postLedgerLegs(base44, {
        groupId: crypto.randomUUID(),
        matchId: match.id,
        walletTransactionId: entryTransaction.id,
        actor: 'user',
        actorId: user.id,
        triggerEvent: 'match_cancelled',
        externalRefType: 'match',
        externalRefId: match.id,
        legs: [
          { ledgerAccount: 'contest_clearing', debit: match.wager_amount, credit: 0, transactionType: 'refund' },
          { ledgerAccount: 'user_account', userId: depositorId, debit: 0, credit: match.wager_amount, heldDelta: -match.wager_amount, transactionType: 'refund', totalWageredDelta: -match.wager_amount },
        ],
      });

      const feeTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
        launch_epoch: 2,
        user_id: depositorId,
        type: 'service_fee_refund',
        amount: serviceFee,
        match_id: match.id,
        description: 'Platform service fee refunded — match cancelled',
        status: 'completed',
      });

      // Separate double-entry: Debit Suspense (never recognized), Credit
      // User Available Balance.
      await postLedgerLegs(base44, {
        groupId: crypto.randomUUID(),
        matchId: match.id,
        walletTransactionId: feeTransaction.id,
        actor: 'user',
        actorId: user.id,
        triggerEvent: 'service_fee_refund',
        externalRefType: 'match',
        externalRefId: match.id,
        legs: [
          { ledgerAccount: 'suspense', debit: serviceFee, credit: 0, transactionType: 'refund' },
          { ledgerAccount: 'user_account', userId: depositorId, debit: 0, credit: serviceFee, heldDelta: -serviceFee, transactionType: 'refund' },
        ],
      });
    }

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'cancelled',
      cancellation_operation_id: cancellationOperationId,
      result: 'cancelled',
    });

    await recordIntegrationEvent(base44, {
      eventType: 'contest.cancelled',
      aggregateType: 'match',
      aggregateId: match.id,
      correlationId: match.id,
      idempotencyKey: `contest.cancelled:${match.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      counterpartyUserId: isP1 ? match.player2_id : match.player1_id,
      matchId: match.id,
      status: updatedMatch.status,
      amount: match.wager_amount,
      result: 'user_cancelled',
      eventData: {
        player1_id: match.player1_id,
        player2_id: match.player2_id || '',
        refunded_user_ids: refundTargets,
      },
    });

    return Response.json({ match: updatedMatch });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});