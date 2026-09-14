import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

// System sweep (invoked on a schedule by the Preparation Timeout Sweep
// workflow — no user session involved, so this never checks auth.me()):
// cancels any match still stuck in the shared Preparing Match phase past the
// readiness timeout, refunding any entry amounts already reserved. Safe to
// call at any time — it only ever acts on matches that are genuinely stale.
//
// Every candidate is re-fetched and re-validated immediately before it is
// claimed for cancellation — the initial query snapshot can be seconds or
// minutes stale by the time a given match is reached in a large sweep, and
// acting on the stale snapshot could refund-and-cancel a match that has, in
// the meantime, become fully certified/funded and started going live via
// finalizeMatchStart. Both sides check and respect each other's
// start_operation_id / cancellation_operation_id claim before committing any
// money movement or status change.

const PREPARATION_TIMEOUT_MS = 2 * 60 * 1000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Reuse this existing sweep for expired invitations, short no-show
    // windows, and interrupted dual-sided journal operations. Oldest due
    // records first; newly created OPEN links never consume an active slot.
    const { recoverChallenge } = await import('../../shared/challengeLifecycle.ts');
    const challengeDue = await base44.asServiceRole.entities.Match.filter({
      launch_epoch: 2, challenge_version: 1,
      $or: [
        { challenge_operation_state: { $in: ['reserving', 'releasing'] } },
        { status: 'searching', challenge_expires_at: { $lte: new Date().toISOString() } },
        { status: { $in: ['preparing', 'both_ready'] }, preparation_started_at: { $lte: new Date(Date.now()-PREPARATION_TIMEOUT_MS).toISOString() } },
      ],
    }, 'created_date', 40);
    const challengeRecovery = { checked: challengeDue.length, recovered: 0, failed: 0 };
    for (const candidate of challengeDue) {
      try { await recoverChallenge(base44, candidate.id); challengeRecovery.recovered++; }
      catch (error) {
        challengeRecovery.failed++;
        console.error(JSON.stringify({ event: 'challenge_sweep_recovery_failed', match_id: candidate.id, error: String(error?.message || 'unknown').slice(0,150) }));
      }
    }

    const [preparing, bothReady] = await Promise.all([
      base44.asServiceRole.entities.Match.filter({ launch_epoch: 2, status: 'preparing' }, '-created_date', 200),
      base44.asServiceRole.entities.Match.filter({ launch_epoch: 2, status: 'both_ready' }, '-created_date', 200),
    ]);

    const now = Date.now();
    const stale = [...preparing, ...bothReady].filter(
      (m) => m.preparation_started_at && now - new Date(m.preparation_started_at).getTime() > PREPARATION_TIMEOUT_MS
    );

    const cancelledIds = [];
    for (const candidate of stale) {
      // Re-fetch fresh state immediately before claiming — never act on the
      // query snapshot taken above.
      let match = await base44.asServiceRole.entities.Match.get(candidate.id);
      if (!match) continue;
      // Challenge-first funds are released in a single balanced batch above,
      // never by the legacy one-player-at-a-time refund path below.
      if (Number(match.challenge_version) === 1) continue;
      if (match.status !== 'preparing' && match.status !== 'both_ready') continue;
      if (
        !match.preparation_started_at ||
        now - new Date(match.preparation_started_at).getTime() <= PREPARATION_TIMEOUT_MS
      ) continue;
      if (match.cancellation_operation_id || match.status === 'cancelling') continue;
      // A start claim already exists, or both players are already certified
      // and funded — this match is actively converging on going live, not
      // abandoned. Never refund-and-cancel it here; finalizeMatchStart's own
      // idempotent retry (re-invoked by the client every few seconds while
      // both players show ready) is what finishes it.
      if (match.start_operation_id) continue;
      const bothCertifiedAlready = match.player1_certified && match.player2_certified;
      const bothDepositedAlready = match.player1_deposited && match.player2_deposited;
      if (bothCertifiedAlready && bothDepositedAlready) continue;

      const serviceFee = Number(match.platform_service_fee);
      if (!Number.isFinite(serviceFee) || serviceFee < 0) continue;

      const cancellationOperationId = crypto.randomUUID();
      await base44.asServiceRole.entities.Match.update(match.id, {
        status: 'cancelling',
        cancellation_operation_id: cancellationOperationId,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      match = await base44.asServiceRole.entities.Match.get(match.id);
      if (match.cancellation_operation_id !== cancellationOperationId) continue;
      if (match.start_operation_id) {
        // finalizeMatchStart won the race and claimed this match for a start
        // transition during our own claim delay. Back off before any refund
        // is posted, and hand the match back to 'both_ready' so the start
        // transition can still complete rather than leaving it stranded
        // mid-cancel with no refund and no game.
        await base44.asServiceRole.entities.Match.update(match.id, {
          status: 'both_ready',
          cancellation_operation_id: '',
        });
        continue;
      }

      const refundTargets = [];
      if (match.player1_deposited) refundTargets.push(match.player1_id);
      if (match.player2_deposited) refundTargets.push(match.player2_id);

      for (const depositorId of refundTargets) {
        const entryTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          launch_epoch: 2,
          user_id: depositorId,
          type: 'wager_refund',
          amount: match.wager_amount,
          match_id: match.id,
          description: 'Reserved contest entry amount refunded — match preparation timed out',
          status: 'completed',
        });

        await postLedgerLegs(base44, {
          groupId: `match:${match.id}:preparation_timeout:${entryTransaction.id}`,
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
          launch_epoch: 2,
          user_id: depositorId,
          type: 'service_fee_refund',
          amount: serviceFee,
          match_id: match.id,
          description: 'Platform service fee refunded — match preparation timed out',
          status: 'completed',
        });

        await postLedgerLegs(base44, {
          groupId: `match:${match.id}:service_fee_refund:${feeTransaction.id}`,
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

    return Response.json({ cancelledCount: cancelledIds.length, cancelledIds, challengeRecovery });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});