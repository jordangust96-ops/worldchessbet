import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

// System sweep (invoked on a schedule by the Preparation Timeout Sweep
// workflow — no user session involved, so this never checks auth.me()):
// cancels any match still stuck in the shared Preparing Match phase past the
// readiness timeout, refunding any entry amounts already reserved. Safe to
// call at any time — it only ever acts on matches that are genuinely stale.

const PREPARATION_TIMEOUT_MS = 2 * 60 * 1000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const [preparing, bothReady] = await Promise.all([
      base44.asServiceRole.entities.Match.filter({ status: 'preparing' }, '-created_date', 200),
      base44.asServiceRole.entities.Match.filter({ status: 'both_ready' }, '-created_date', 200),
    ]);

    const now = Date.now();
    const stale = [...preparing, ...bothReady].filter(
      (m) => m.preparation_started_at && now - new Date(m.preparation_started_at).getTime() > PREPARATION_TIMEOUT_MS
    );

    const cancelledIds = [];
    for (const candidate of stale) {
      let match = candidate;
      const serviceFee = Number(match.platform_service_fee);
      if (!Number.isFinite(serviceFee) || serviceFee < 0) continue;
      if (match.cancellation_operation_id || match.status === 'cancelling') continue;

      const cancellationOperationId = crypto.randomUUID();
      await base44.asServiceRole.entities.Match.update(match.id, {
        status: 'cancelling',
        cancellation_operation_id: cancellationOperationId,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      match = await base44.asServiceRole.entities.Match.get(match.id);
      if (match.cancellation_operation_id !== cancellationOperationId) continue;

      const refundTargets = [];
      if (match.player1_deposited) refundTargets.push(match.player1_id);
      if (match.player2_deposited) refundTargets.push(match.player2_id);

      for (const depositorId of refundTargets) {
        const entryTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: depositorId,
          type: 'wager_refund',
          amount: match.wager_amount,
          match_id: match.id,
          description: 'Reserved contest entry amount refunded — match preparation timed out',
          status: 'completed',
        });

        await postLedgerLegs(base44, {
          groupId: crypto.randomUUID(),
          matchId: match.id,
          walletTransactionId: entryTransaction.id,
          actor: 'system',
          triggerEvent: 'preparation_timeout',
          externalRefType: 'match',
          externalRefId: match.id,
          legs: [
            { ledgerAccount: 'contest_clearing', debit: match.wager_amount, credit: 0, transactionType: 'refund' },
            { ledgerAccount: 'user_account', userId: depositorId, debit: 0, credit: match.wager_amount, heldDelta: -match.wager_amount, transactionType: 'refund', totalWageredDelta: -match.wager_amount },
          ],
        });

        const feeTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          user_id: depositorId,
          type: 'service_fee_refund',
          amount: serviceFee,
          match_id: match.id,
          description: 'Platform service fee refunded — match preparation timed out',
          status: 'completed',
        });

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
            { ledgerAccount: 'user_account', userId: depositorId, debit: 0, credit: serviceFee, heldDelta: -serviceFee, transactionType: 'refund' },
          ],
        });
      }

      const cancelledMatch = await base44.asServiceRole.entities.Match.update(match.id, {
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
        actorType: 'system',
        userId: match.player1_id,
        counterpartyUserId: match.player2_id || '',
        matchId: match.id,
        status: cancelledMatch.status,
        amount: match.wager_amount,
        result: 'preparation_timeout',
        eventData: {
          player1_id: match.player1_id,
          player2_id: match.player2_id || '',
          refunded_user_ids: refundTargets,
        },
      });
      cancelledIds.push(match.id);
    }

    return Response.json({ cancelledCount: cancelledIds.length, cancelledIds });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});