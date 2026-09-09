import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import {
  buildCheckLookupPath,
  mapTransactionStatus,
  seamlessConfig,
  seamlessRequest,
  SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import {
  releaseDepositAvailability,
  reverseSeamlessSettlement,
} from '../../shared/seamlessLedgerTransitions.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

function clean(value, max = 255) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function providerStatus(data) {
  return clean(
    data?.status || data?.check?.status ||
    data?.data?.status || data?.data?.check?.status,
    64
  );
}

// A processed ACH debit is first held in the wallet's clearing balance. This
// scheduled control performs a fresh provider lookup after the return-risk
// window and only then releases it into spendable/withdrawable funds.
Deno.serve(async (req) => {
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    seamlessConfig();

    const held = await base44.asServiceRole.entities.WalletTransaction.filter(
      { type: 'deposit', status: 'completed', deposit_hold_status: 'held' },
      'deposit_release_at',
      500
    );
    const due = held.filter((tx) => {
      const releaseAt = Date.parse(tx.deposit_release_at || '');
      return Number.isFinite(releaseAt) && releaseAt <= now.getTime();
    }).slice(0, 50);

    const summary = { held: held.length, due: due.length, checked: 0, released: 0, returned: 0, pending: 0, errors: 0 };
    for (const tx of due) {
      try {
        const refs = await base44.asServiceRole.entities.IntegrationReference.filter({
          provider_key: SEAMLESS_PROVIDER_KEY,
          wallet_transaction_id: tx.id,
        }, '-effective_at', 10);
        const ref = refs.find((candidate) =>
          candidate.external_reference_id &&
          !String(candidate.external_reference_id).startsWith('chessbet-')
        );
        const checkId = clean(ref?.external_reference_id);
        if (!checkId) throw new Error('missing_check_id');

        const data = await seamlessRequest('GET', buildCheckLookupPath(checkId));
        const rawStatus = providerStatus(data);
        if (!rawStatus) throw new Error('missing_provider_status');
        const normalized = mapTransactionStatus(rawStatus);
        summary.checked += 1;

        await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
          provider_last_status: rawStatus,
          provider_last_checked_at: nowIso,
        });

        if (normalized === 'completed') {
          if (await releaseDepositAvailability(base44, tx)) summary.released += 1;
        } else if (normalized === 'failed' || normalized === 'reversed') {
          await reverseSeamlessSettlement(
            base44,
            tx,
            Number(tx.amount),
            checkId,
            'deposit_clearance_check_returned'
          );
          summary.returned += 1;
        } else {
          summary.pending += 1;
        }

        await recordIntegrationEvent(base44, {
          eventType: 'financial.deposit_clearance_check',
          aggregateType: 'wallet_transaction',
          aggregateId: tx.id,
          correlationId: tx.id,
          idempotencyKey: `deposit-clearance:${tx.id}:${rawStatus.toLowerCase()}:${now.toISOString().slice(0, 10)}`,
          actorType: 'system',
          userId: tx.user_id,
          walletTransactionId: tx.id,
          status: normalized,
          amount: tx.amount,
          result: rawStatus,
          eventData: { provider: SEAMLESS_PROVIDER_KEY, provider_ref: checkId, release_due_at: tx.deposit_release_at },
        });
      } catch (error) {
        summary.errors += 1;
        console.error(JSON.stringify({
          event: 'deposit_clearance_check_failed',
          wallet_transaction_id: tx.id,
          error: clean(error?.message || 'unknown_error', 128),
        }));
      }
    }

    return Response.json(summary);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'deposit_clearance_sweep_failed',
      error: clean(error?.message || 'unknown_error', 128),
    }));
    return Response.json({ error: 'deposit_clearance_sweep_failed' }, { status: 500 });
  }
});
