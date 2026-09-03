import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  applyWebhookEvent,
  buildCheckLookupPath,
  mapTransactionStatus,
  seamlessConfig,
  seamlessRequest,
  SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';
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

function isClosedTrackerState(state: unknown) {
  return ['failed', 'reversed', 'manual_review', 'settled'].includes(String(state || ''));
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

async function hasLedgerGroup(base44: any, groupId: string) {
  return (
    await base44.asServiceRole.entities.LedgerEntry.filter(
      { ledger_group_id: groupId },
      '-created_date',
      1
    )
  ).length > 0;
}

async function upsertTracker(base44: any, tracker: any, fields: any) {
  if (tracker?.id) {
    return base44.asServiceRole.entities.SeamlessStatusReconciliation.update(
      tracker.id,
      fields
    );
  }
  return base44.asServiceRole.entities.SeamlessStatusReconciliation.create(fields);
}

async function postSettlement(base44: any, tx: any, amount: number, providerRef: string) {
  const groupId = tx.type === 'deposit'
    ? `seamless:deposit:settle:${tx.id}`
    : `seamless:withdrawal:settle:${tx.id}`;

  if (!await hasLedgerGroup(base44, groupId)) {
    if (tx.type === 'deposit') {
      await postLedgerLegs(base44, {
        groupId,
        walletTransactionId: tx.id,
        actor: 'system',
        triggerEvent: 'deposit',
        externalRefType: 'provider_payment',
        externalRefId: providerRef,
        legs: [
          {
            ledgerAccount: 'settlement',
            debit: amount,
            credit: 0,
            transactionType: 'deposit',
          },
          {
            ledgerAccount: 'user_account',
            userId: tx.user_id,
            debit: 0,
            credit: amount,
            transactionType: 'deposit',
            totalDepositedDelta: amount,
          },
        ],
      });
    } else {
      await postLedgerLegs(base44, {
        groupId,
        walletTransactionId: tx.id,
        actor: 'system',
        triggerEvent: 'withdrawal',
        externalRefType: 'provider_payout',
        externalRefId: providerRef,
        legs: [
          {
            ledgerAccount: 'withdrawal_reserve',
            debit: amount,
            credit: 0,
            transactionType: 'withdrawal',
          },
          {
            ledgerAccount: 'settlement',
            debit: 0,
            credit: amount,
            transactionType: 'withdrawal',
          },
          {
            ledgerAccount: 'user_account',
            userId: tx.user_id,
            debit: 0,
            credit: 0,
            heldDelta: -amount,
            transactionType: 'withdrawal',
            totalWithdrawnDelta: amount,
          },
        ],
      });
    }
  }

  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'completed',
    integration_status: 'settled',
    ledger_group_id: groupId,
    processed_at: new Date().toISOString(),
    source_event: 'seamless_status_lookup_settled',
  });
}

async function releaseWithdrawal(base44: any, tx: any, amount: number, providerRef: string) {
  const groupId = `seamless:withdrawal:release:${tx.id}`;
  if (!await hasLedgerGroup(base44, groupId)) {
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: tx.id,
      actor: 'system',
      triggerEvent: 'withdrawal_reservation_release',
      externalRefType: 'provider_payout',
      externalRefId: providerRef,
      legs: [
        {
          ledgerAccount: 'withdrawal_reserve',
          debit: amount,
          credit: 0,
          transactionType: 'reversal',
        },
        {
          ledgerAccount: 'user_account',
          userId: tx.user_id,
          debit: 0,
          credit: amount,
          heldDelta: -amount,
          transactionType: 'reversal',
        },
      ],
    });
  }
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'failed',
    integration_status: 'failed',
    ledger_group_id: groupId,
    processed_at: new Date().toISOString(),
    source_event: 'seamless_status_lookup_failed',
  });
}

async function reverseSettlement(base44: any, tx: any, amount: number, providerRef: string) {
  const groupId = tx.type === 'deposit'
    ? `seamless:deposit:reverse:${tx.id}`
    : `seamless:withdrawal:reverse:${tx.id}`;

  if (!await hasLedgerGroup(base44, groupId)) {
    if (tx.type === 'deposit') {
      await postLedgerLegs(base44, {
        groupId,
        walletTransactionId: tx.id,
        actor: 'system',
        triggerEvent: 'refund',
        externalRefType: 'provider_refund',
        externalRefId: providerRef,
        legs: [
          {
            ledgerAccount: 'user_account',
            userId: tx.user_id,
            debit: amount,
            credit: 0,
            transactionType: 'refund',
            totalDepositedDelta: -amount,
          },
          {
            ledgerAccount: 'settlement',
            debit: 0,
            credit: amount,
            transactionType: 'refund',
          },
        ],
      });
    } else {
      await postLedgerLegs(base44, {
        groupId,
        walletTransactionId: tx.id,
        actor: 'system',
        triggerEvent: 'reversal',
        externalRefType: 'provider_reversal',
        externalRefId: providerRef,
        legs: [
          {
            ledgerAccount: 'settlement',
            debit: amount,
            credit: 0,
            transactionType: 'reversal',
          },
          {
            ledgerAccount: 'user_account',
            userId: tx.user_id,
            debit: 0,
            credit: amount,
            transactionType: 'reversal',
            totalWithdrawnDelta: -amount,
          },
        ],
      });
    }
  }

  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'reversed',
    integration_status: 'reversed',
    ledger_group_id: groupId,
    processed_at: new Date().toISOString(),
    source_event: 'seamless_status_lookup_reversed',
  });
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

  if (decision.action === 'post') {
    await postSettlement(base44, tx, amount, providerRef);
  } else if (decision.action === 'reverse') {
    await reverseSettlement(base44, tx, amount, providerRef);
  } else if (decision.action === 'fail') {
    if (tx.type === 'withdrawal') {
      await releaseWithdrawal(base44, tx, amount, providerRef);
    } else {
      await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
        status: decision.status,
        integration_status: 'failed',
        processed_at: new Date().toISOString(),
        source_event: 'seamless_status_lookup_failed',
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
    seamlessConfig();
    const base44 = createClientFromRequest(req);

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
        if (isClosedTrackerState(tracker?.state)) return false;
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
          providerHttpStatus === 408 ||
          providerHttpStatus === 429 ||
          providerHttpStatus >= 500;
        const errorCode = providerHttpStatus
          ? `seamless_http_${providerHttpStatus}`
          : cleanText((error as any)?.message || 'status_lookup_failed', 128)
              .toLowerCase()
              .replace(/[^a-z0-9_-]+/g, '_');

        tracker = await upsertTracker(base44, tracker, {
          wallet_transaction_id: candidate.id,
          provider_reference_id: providerRef,
          state: retryable ? 'retryable_error' : 'manual_review',
          provider_status: tracker?.provider_status || '',
          normalized_status: tracker?.normalized_status || 'pending',
          attempt_count: attemptCount,
          first_seen_at: firstSeenAt,
          last_checked_at: nowIso,
          next_check_at: retryable ? nextLookupAt(attemptCount, nowMs) : nowIso,
          completed_at: retryable ? '' : nowIso,
          last_error_code: errorCode,
          description: retryable
            ? 'Status lookup failed safely and will retry after backoff.'
            : 'Status lookup requires manual review; no financial state was changed.',
        });
        trackerByTransaction.set(candidate.id, tracker);
        if (retryable) summary.retryable_errors += 1;
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
