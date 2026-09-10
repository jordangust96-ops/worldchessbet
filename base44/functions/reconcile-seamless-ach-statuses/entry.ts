import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  applyWebhookEvent,
  buildCheckLookupPath,
  mapTransactionStatus,
  seamlessConfig,
  seamlessRequest,
  SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import {
  postSeamlessSettlement,
  releaseSeamlessWithdrawal,
  reverseSeamlessSettlement,
} from '../../shared/seamlessLedgerTransitions.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { claimWebhookEvent, finishWebhookEvent } from '../../shared/seamlessAtomicStore.ts';

// Read-only provider lookups feed the same exactly-once ledger transitions as webhooks.
const INITIAL_DELAY_MS = 15 * 60 * 1000;
const MAX_LOOKUP_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const POST_SETTLEMENT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKOFF_MS = [
  30 * 60 * 1000,
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];
const FETCH_LIMIT = 500;
const BATCH_LIMIT = 25;

function cleanText(value: unknown, max: number) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function timeMs(value: unknown) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextLookupAt(attemptCount: number, nowMs: number) {
  const index = Math.min(Math.max(attemptCount - 1, 0), BACKOFF_MS.length - 1);
  return new Date(nowMs + BACKOFF_MS[index]).toISOString();
}

function terminalTrackerState(status: string) {
  if (status === 'reversed') return 'reversed';
  if (status === 'failed') return 'failed';
  return '';
}

function isClosedTrackerState(tracker: any) {
  const state = String(tracker?.state || '');
  // A newly accepted ACH debit can temporarily return 404 from the single-check
  // endpoint while it is already visible in Seamless's dashboard. Keep those
  // records in automated recovery instead of stranding them in manual review.
  if (state === 'manual_review' && tracker?.last_error_code === 'seamless_http_404') return false;
  return ['failed', 'reversed', 'manual_review', 'settled'].includes(state);
}

function extractProviderStatus(data: any) {
  return cleanText(
    data?.status ||
    data?.check?.status ||
    data?.data?.status ||
    data?.data?.check?.status,
    64
  );
}

function extractProviderReference(data: any) {
  return cleanText(
    data?.check_id ||
    data?.check?.check_id ||
    data?.check?.id ||
    data?.data?.check_id ||
    data?.data?.check?.check_id ||
    data?.data?.check?.id ||
    data?.id,
    255
  );
}

async function upsertTracker(base44: any, tracker: any, fields: any) {
  if (tracker?.id) {
    return base44.asServiceRole.entities.SeamlessStatusReconciliation.update(tracker.id, fields);
  }
  return base44.asServiceRole.entities.SeamlessStatusReconciliation.create(fields);
}

async function applyRecoveredStatus(
  base44: any,
  tx: any,
  providerRef: string,
  providerStatus: string,
  idemKey: string
) {
  if (!['deposit', 'withdrawal'].includes(tx.type)) {
    throw new Error('unsupported_wallet_transaction_type');
  }

  const decision = applyWebhookEvent(tx, { status: providerStatus });
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('invalid_wallet_transaction_amount');
  }

  const checkedAt = new Date().toISOString();
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    provider_last_status: providerStatus || 'unknown',
    provider_last_checked_at: checkedAt,
  });

  if (decision.action === 'post') {
    await postSeamlessSettlement(base44, tx, amount, providerRef, 'seamless_status_lookup_settled');
  } else if (decision.action === 'reverse') {
    await reverseSeamlessSettlement(base44, tx, amount, providerRef, 'seamless_status_lookup_reversed');
  } else if (decision.action === 'fail') {
    if (tx.type === 'withdrawal') {
      await releaseSeamlessWithdrawal(
        base44, tx, amount, providerRef,
        'The bank transfer did not complete. The withdrawal and any small-withdrawal fee were returned to your wallet.',
        'seamless_status_lookup_failed'
      );
    } else {
      await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
        status: decision.status,
        integration_status: 'failed',
        deposit_hold_status: 'void',
        processed_at: checkedAt,
        source_event: 'seamless_status_lookup_failed',
        description: 'Deposit failed — the bank transfer did not complete. No funds were added to your available balance.',
      });
    }
  }

  if (decision.status !== 'pending') {
    const refs = await base44.asServiceRole.entities.IntegrationReference.filter({
      provider_key: SEAMLESS_PROVIDER_KEY,
      wallet_transaction_id: tx.id,
      external_reference_id: providerRef,
    });
    for (const ref of refs) {
      await base44.asServiceRole.entities.IntegrationReference.update(ref.id, {
        status: decision.status,
        effective_at: new Date().toISOString(),
      });
    }
  }

  await recordIntegrationEvent(base44, {
    eventType: `seamless.status_lookup.${decision.action}`,
    aggregateType: 'wallet_transaction',
    aggregateId: tx.id,
    correlationId: tx.id,
    idempotencyKey: `audit:${idemKey}`,
    actorType: 'system',
    userId: tx.user_id,
    walletTransactionId: tx.id,
    status: decision.status,
    amount: tx.amount,
    result: providerStatus,
    eventData: {
      provider: SEAMLESS_PROVIDER_KEY,
      provider_ref: providerRef,
      provider_status: providerStatus,
      action: decision.action,
      recovery_source: 'single_check_lookup',
    },
  });

  return decision;
}

Deno.serve(async (req) => {
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    seamlessConfig();

    const [
      submitted,
      uncertain,
      submitting,
      settled,
      trackers,
    ] = await Promise.all([
      base44.asServiceRole.entities.WalletTransaction.filter(
        { status: 'pending', integration_status: 'submitted' },
        'created_date',
        FETCH_LIMIT
      ),
      base44.asServiceRole.entities.WalletTransaction.filter(
        { status: 'pending', integration_status: 'uncertain' },
        'created_date',
        FETCH_LIMIT
      ),
      base44.asServiceRole.entities.WalletTransaction.filter(
        { status: 'pending', integration_status: 'submitting' },
        'created_date',
        FETCH_LIMIT
      ),
      base44.asServiceRole.entities.WalletTransaction.filter(
        { status: 'completed', integration_status: 'settled' },
        '-created_date',
        FETCH_LIMIT
      ),
      base44.asServiceRole.entities.SeamlessStatusReconciliation.list(
        '-updated_date',
        FETCH_LIMIT * 4
      ),
    ]);

    const trackerByTransaction = new Map();
    for (const tracker of trackers) {
      if (!trackerByTransaction.has(tracker.wallet_transaction_id)) {
        trackerByTransaction.set(tracker.wallet_transaction_id, tracker);
      }
    }

    const byId = new Map();
    for (const tx of [...submitted, ...uncertain, ...submitting, ...settled]) {
      if (['deposit', 'withdrawal'].includes(tx.type)) byId.set(tx.id, tx);
    }

    const candidates = [...byId.values()]
      .filter((tx) => {
        const createdAt = timeMs(tx.created_date);
        if (!createdAt || nowMs - createdAt < INITIAL_DELAY_MS) return false;
        const tracker = trackerByTransaction.get(tx.id);
        if (isClosedTrackerState(tracker)) return false;
        return !tracker?.next_check_at || timeMs(tracker.next_check_at) <= nowMs;
      })
      .sort((a, b) => {
        const priority = Number(a.status === 'completed') - Number(b.status === 'completed');
        return priority || timeMs(a.created_date) - timeMs(b.created_date);
      })
      .slice(0, BATCH_LIMIT);

    const summary = {
      candidates: byId.size,
      due: candidates.length,
      checked: 0,
      pending: 0,
      settled: 0,
      failed: 0,
      reversed: 0,
      retryable_errors: 0,
      manual_review: 0,
      busy: 0,
    };

    for (const candidate of candidates) {
      let tracker = trackerByTransaction.get(candidate.id) || null;
      const firstSeenAt = tracker?.first_seen_at || candidate.created_date || nowIso;
      const ageMs = nowMs - timeMs(firstSeenAt);

      const refs = await base44.asServiceRole.entities.IntegrationReference.filter(
        {
          provider_key: SEAMLESS_PROVIDER_KEY,
          wallet_transaction_id: candidate.id,
        },
        '-effective_at',
        10
      );
      const providerRefRecord = refs.find((ref: any) =>
        ref.external_reference_id &&
        !String(ref.external_reference_id).startsWith('chessbet-')
      ) || null;
      const providerRef = cleanText(providerRefRecord?.external_reference_id, 255);

      if (ageMs > MAX_LOOKUP_AGE_MS && candidate.status === 'completed') {
        tracker = await upsertTracker(base44, tracker, {
          wallet_transaction_id: candidate.id,
          provider_reference_id: providerRef,
          state: 'settled',
          provider_status: tracker?.provider_status || '',
          normalized_status: 'completed',
          attempt_count: Number(tracker?.attempt_count || 0),
          first_seen_at: firstSeenAt,
          last_checked_at: tracker?.last_checked_at || '',
          next_check_at: nowIso,
          completed_at: nowIso,
          last_error_code: '',
          description: 'Post-settlement monitoring window completed without a recovered return.',
        });
        trackerByTransaction.set(candidate.id, tracker);
        summary.settled += 1;
        continue;
      }

      if (!providerRef || ageMs > MAX_LOOKUP_AGE_MS) {
        tracker = await upsertTracker(base44, tracker, {
          wallet_transaction_id: candidate.id,
          provider_reference_id: providerRef,
          state: 'manual_review',
          provider_status: tracker?.provider_status || '',
          normalized_status: tracker?.normalized_status || 'pending',
          attempt_count: Number(tracker?.attempt_count || 0),
          first_seen_at: firstSeenAt,
          last_checked_at: tracker?.last_checked_at || '',
          next_check_at: nowIso,
          completed_at: nowIso,
          last_error_code: providerRef ? 'lookup_window_expired' : 'missing_check_id',
          description: providerRef
            ? 'Automated lookup window ended without a terminal provider status.'
            : 'Seamless check_id was not returned or persisted; labels cannot be used for lookup.',
        });
        trackerByTransaction.set(candidate.id, tracker);
        summary.manual_review += 1;

        await recordIntegrationEvent(base44, {
          eventType: 'seamless.status_lookup.manual_review',
          aggregateType: 'wallet_transaction',
          aggregateId: candidate.id,
          correlationId: candidate.id,
          idempotencyKey: `seamless:lookup:manual-review:${candidate.id}`,
          actorType: 'system',
          userId: candidate.user_id,
          walletTransactionId: candidate.id,
          status: 'manual_review',
          amount: candidate.amount,
          result: providerRef ? 'lookup_window_expired' : 'missing_check_id',
          eventData: {
            provider: SEAMLESS_PROVIDER_KEY,
            provider_ref: providerRef,
            labels_not_supported_for_lookup: true,
          },
        });
        continue;
      }

      const attemptCount = Number(tracker?.attempt_count || 0) + 1;
      try {
        const data = await seamlessRequest('GET', buildCheckLookupPath(providerRef));
        const responseRef = extractProviderReference(data);
        if (responseRef && responseRef !== providerRef) {
          throw new Error('provider_reference_mismatch');
        }

        const providerStatus = extractProviderStatus(data);
        if (!providerStatus) throw new Error('missing_provider_status');

        const statusKey = cleanText(providerStatus, 64).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
        const idemKey = `seamless:lookup:${providerRef}:${statusKey || 'unknown'}`;
        const owner = crypto.randomUUID();
        const claim = await claimWebhookEvent(idemKey, providerRef, owner);

        if (claim?.claim === 'busy' || claim?.claim === 'transaction_busy') {
          summary.busy += 1;
          continue;
        }

        if (claim?.claim === 'owned') {
          try {
            const freshTx = await base44.asServiceRole.entities.WalletTransaction.get(candidate.id);
            await applyRecoveredStatus(base44, freshTx, providerRef, providerStatus, idemKey);
            await finishWebhookEvent(idemKey, providerRef, owner, 'completed');
          } catch (error) {
            try {
              await finishWebhookEvent(
                idemKey,
                providerRef,
                owner,
                'retryable',
                'status_lookup_apply_failed'
              );
            } catch {
              // The lease safely expires if the atomic store is temporarily unavailable.
            }
            throw error;
          }
        } else if (claim?.claim !== 'completed') {
          throw new Error('status_lookup_claim_failed');
        }

        const refreshed = await base44.asServiceRole.entities.WalletTransaction.get(candidate.id);
        const terminalState = terminalTrackerState(refreshed.status);
        const isSettled = refreshed.status === 'completed';
        const normalizedStatus = mapTransactionStatus(providerStatus);
        tracker = await upsertTracker(base44, tracker, {
          wallet_transaction_id: candidate.id,
          provider_reference_id: providerRef,
          state: terminalState || 'active',
          provider_status: providerStatus,
          normalized_status: normalizedStatus,
          attempt_count: attemptCount,
          first_seen_at: firstSeenAt,
          last_checked_at: nowIso,
          next_check_at: terminalState
            ? nowIso
            : isSettled
              ? new Date(nowMs + POST_SETTLEMENT_INTERVAL_MS).toISOString()
              : nextLookupAt(attemptCount, nowMs),
          completed_at: terminalState ? nowIso : '',
          last_error_code: '',
          description: terminalState
            ? 'Terminal ACH status recovered through the Seamless single-check endpoint.'
            : isSettled
              ? 'ACH settled; checking daily during the bounded return-monitoring window.'
              : 'Awaiting a terminal ACH status; the next lookup is rate-limited by backoff.',
        });
        trackerByTransaction.set(candidate.id, tracker);
        summary.checked += 1;
        if (terminalState) summary[terminalState] += 1;
        else if (isSettled) summary.settled += 1;
        else summary.pending += 1;
      } catch (error) {
        const providerHttpStatus = Number((error as any)?.status || 0);
        const retryable = !providerHttpStatus ||
          providerHttpStatus === 404 ||
          providerHttpStatus === 408 ||
          providerHttpStatus === 429 ||
          providerHttpStatus >= 500;
        const errorCode = providerHttpStatus
          ? `seamless_http_${providerHttpStatus}`
          : cleanText((error as any)?.message || 'status_lookup_failed', 128)
              .toLowerCase()
              .replace(/[^a-z0-9_-]+/g, '_');
        const webhookConfirmedPending =
          providerHttpStatus === 404 &&
          cleanText(candidate.provider_last_status, 64).toLowerCase() === 'pending';

        tracker = await upsertTracker(base44, tracker, {
          wallet_transaction_id: candidate.id,
          provider_reference_id: providerRef,
          state: webhookConfirmedPending ? 'active' : retryable ? 'retryable_error' : 'manual_review',
          provider_status: webhookConfirmedPending ? 'pending' : tracker?.provider_status || '',
          normalized_status: tracker?.normalized_status || 'pending',
          attempt_count: attemptCount,
          first_seen_at: firstSeenAt,
          last_checked_at: nowIso,
          next_check_at: retryable ? nextLookupAt(attemptCount, nowMs) : nowIso,
          completed_at: retryable ? '' : nowIso,
          last_error_code: webhookConfirmedPending ? '' : errorCode,
          description: webhookConfirmedPending
            ? 'Seamless reported the transaction pending by webhook; the single-payment endpoint has not indexed it yet, so recovery will retry after backoff.'
            : retryable
              ? 'Status lookup failed safely and will retry after backoff.'
              : 'Status lookup requires manual review; no financial state was changed.',
        });
        trackerByTransaction.set(candidate.id, tracker);
        if (webhookConfirmedPending) summary.pending += 1;
        else if (retryable) summary.retryable_errors += 1;
        else summary.manual_review += 1;

        console.error(JSON.stringify({
          event: 'seamless_status_lookup_failed',
          wallet_transaction_id: candidate.id,
          provider_reference_id: providerRef,
          error_code: errorCode,
          retryable,
        }));
      }
    }

    return Response.json(summary);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'seamless_status_reconciliation_failed',
      error: cleanText((error as any)?.message || 'internal_error', 128),
    }));
    return Response.json({ error: 'seamless_status_reconciliation_failed' }, { status: 500 });
  }
});
