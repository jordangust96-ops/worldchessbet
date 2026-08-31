import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  verifySeamlessWebhookAuth, webhookIdempotencyKey, mapTransactionStatus,
  applyWebhookEvent, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

// Seamless ACH webhook receiver. Publicly reachable at:
//   https://chessbetv1.base44.app/functions/seamlessAchWebhook
//
// Handles both funding-source.* events (bank lifecycle) and transaction.status
// events (money). Security rules enforced here:
//  - Verify Authorization against SEAMLESS_ACH_SECRET_KEY in constant time;
//    reject (401 non-2xx) on missing/malformed/mismatched auth so Seamless
//    retries. NEVER log the header or the secret.
//  - Idempotent by event_id (or stable hash). Duplicate/out-of-order events
//    never double-post the ledger.
//  - Return 2xx ONLY after the event is durably recorded/applied; return
//    non-2xx on processing failure so Seamless retries.
//  - ONLY a Processed provider status posts the final balanced ledger and
//    moves the wallet (via the authoritative postLedgerLegs helper — never a
//    direct balance edit). Failure/refund after settlement reverses via a
//    balanced reversal.

const FUNDING_SOURCE_EVENTS = new Set([
  'funding-source.added', 'funding-source.updated', 'funding-source.verified',
  'funding-source.deleted', 'funding-source.made-primary',
  'funding-source.pending-verification', 'funding-source.verification-failed',
  'funding-source.verification-expired',
]);

function pickCheckId(body) {
  return body?.check?.id || body?.check?.check_id || body?.check_id || body?.id || '';
}
function pickSourceId(body) {
  return body?.source?.id || body?.source_id || body?.funding_source?.id || body?.fundingSourceId || '';
}
function pickEventType(body) {
  return body?.event || body?.event_type || body?.type || '';
}
function pickEventId(body) {
  return body?.event_id || body?.id || body?.webhook_id || '';
}
function pickStatus(body) {
  return body?.status || body?.check?.status || '';
}
function pickAmount(body) {
  const a = body?.amount ?? body?.check?.amount;
  const n = Number(a);
  return Number.isFinite(n) ? n / 100 : undefined; // Seamless sends cents
}
function pickTimestamp(body) {
  return body?.timestamp || body?.created_at || body?.occurred_at || new Date().toISOString();
}

Deno.serve(async (req) => {
  // 1. Auth — fail closed, constant time, never logged.
  if (!verifySeamlessWebhookAuth(req.headers.get('authorization'))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const eventType = pickEventType(body);
  const eventId = pickEventId(body);
  const providerRef = pickCheckId(body) || pickSourceId(body);
  const timestamp = pickTimestamp(body);

  // 2. Idempotency key (event_id if present, else stable hash).
  const idemKey = webhookIdempotencyKey({
    eventId, providerRef, eventType, status: pickStatus(body), timestamp,
  });

  try {
    const base44 = createClientFromRequest(req);
    // No user context — webhooks are server-to-server. Operate as service role.

    // 3. Funding-source lifecycle events -> update SeamlessBankAccount only.
    if (eventType.startsWith('funding-source.')) {
      return await handleFundingSource(base44, body, eventType, idemKey);
    }

    // 4. Transaction status events -> money state machine.
    if (eventType === 'transaction.status' || eventType.startsWith('transaction.') || eventType === 'check.status' || eventType === 'status') {
      return await handleTransaction(base44, body, eventType, idemKey, providerRef);
    }

    // Unknown event type — record it for audit and ack so it isn't retried.
    await recordIntegrationEvent(base44, {
      eventType: `seamless.webhook.unknown:${eventType || 'unknown'}`,
      aggregateType: 'integration_reference',
      aggregateId: providerRef || eventId || idemKey,
      correlationId: providerRef || eventId || idemKey,
      idempotencyKey: idemKey,
      actorType: 'system',
      userId: '',
      status: 'ignored',
      eventData: { event_type: eventType, provider_ref: providerRef },
    });
    return Response.json({ received: true, ignored: true });
  } catch (error) {
    // Non-2xx -> Seamless retries. Never leak secrets in the message.
    return Response.json(
      { error: 'webhook_processing_failed' },
      { status: 500 }
    );
  }
});

async function handleFundingSource(base44, body, eventType, idemKey) {
  const statusMap = {
    'funding-source.added': 'added',
    'funding-source.updated': 'added',
    'funding-source.pending-verification': 'pending_verification',
    'funding-source.verified': 'verified',
    'funding-source.verification-failed': 'verification_failed',
    'funding-source.verification-expired': 'verification_expired',
    'funding-source.deleted': 'deleted',
    'funding-source.made-primary': 'verified',
  };
  const bankStatus = statusMap[eventType] || 'added';

  const sourceId = pickSourceId(body) || pickCheckId(body);
  const providerUserId = body?.user_id || body?.user?.id || '';
  const accountName = body?.account?.name || body?.name || '';
  const accountMask = body?.account?.mask || body?.mask || body?.last4 || '';

  // Idempotency: if we've already recorded this event, ack without re-applying.
  const existing = (
    await base44.asServiceRole.entities.IntegrationEvent.filter(
      { idempotency_key: idemKey }, '-created_date', 1
    )
  )[0];
  if (existing) return Response.json({ received: true, deduplicated: true });

  // Locate the user's bank account by source_id (created on browser callback
  // landing-page fetch, or matched here by provider_user_id if missing). Only
  // the webhook sets status='verified'.
  let bank = null;
  if (sourceId) {
    bank = (await base44.asServiceRole.entities.SeamlessBankAccount.filter({ source_id: sourceId }))[0];
  }
  if (!bank && providerUserId) {
    bank = (await base44.asServiceRole.entities.SeamlessBankAccount.filter({ provider_user_id: providerUserId }))[0];
  }

  if (bank) {
    const updates = { status: bankStatus };
    if (bankStatus === 'verified') updates.verified_at = new Date().toISOString();
    if (eventType === 'funding-source.made-primary') { updates.is_primary = true; if (bank.status !== 'verified') updates.status = 'verified'; }
    if (accountName) updates.account_name = accountName;
    if (accountMask) updates.account_mask = accountMask;
    await base44.asServiceRole.entities.SeamlessBankAccount.update(bank.id, updates);
  }

  await recordIntegrationEvent(base44, {
    eventType: `seamless.${eventType}`,
    aggregateType: 'wallet',
    aggregateId: bank?.user_id || providerUserId || sourceId || idemKey,
    correlationId: sourceId || providerUserId || idemKey,
    idempotencyKey: idemKey,
    actorType: 'system',
    userId: bank?.user_id || '',
    status: bankStatus,
    eventData: { source_id: sourceId, provider_user_id: providerUserId, bank_id: bank?.id || '' },
  });

  return Response.json({ received: true, applied: true });
}

async function handleTransaction(base44, body, eventType, idemKey, providerRef) {
  const status = pickStatus(body);

  // Idempotency gate — duplicate event ack without re-processing.
  const existing = (
    await base44.asServiceRole.entities.IntegrationEvent.filter(
      { idempotency_key: idemKey }, '-created_date', 1
    )
  )[0];
  if (existing) return Response.json({ received: true, deduplicated: true });

  // Correlate to a WalletTransaction via IntegrationReference.external_reference_id.
  const ref = providerRef
    ? (await base44.asServiceRole.entities.IntegrationReference.filter({ external_reference_id: providerRef }))[0]
    : null;
  if (!ref || !ref.wallet_transaction_id) {
    // Unknown transaction — record for audit, ack (no ledger post).
    await recordIntegrationEvent(base44, {
      eventType: `seamless.${eventType || 'transaction'}.unknown`,
      aggregateType: 'integration_reference',
      aggregateId: providerRef || idemKey,
      correlationId: providerRef || idemKey,
      idempotencyKey: idemKey,
      actorType: 'system',
      userId: ref?.user_id || '',
      status: mapTransactionStatus(status),
      amount,
      eventData: { provider_ref: providerRef, raw_status: status },
    });
    return Response.json({ received: true, unmatched: true });
  }

  const tx = await base44.asServiceRole.entities.WalletTransaction.get(ref.wallet_transaction_id);
  if (!tx) {
    await recordIntegrationEvent(base44, {
      eventType: `seamless.${eventType || 'transaction'}.missing_tx`,
      aggregateType: 'wallet_transaction',
      aggregateId: ref.wallet_transaction_id,
      correlationId: ref.wallet_transaction_id,
      idempotencyKey: idemKey,
      actorType: 'system',
      status: mapTransactionStatus(status),
      eventData: { provider_ref: providerRef },
    });
    return Response.json({ received: true, missing: true });
  }

  const decision = applyWebhookEvent(tx, { status });

  if (decision.action === 'post') {
    // First Settled/Processed: post the balanced settlement ledger EXACTLY ONCE.
    // Always use our own stored tx.amount — never the provider-reported amount.
    await postSettlement(base44, tx, tx.amount, ref);
  } else if (decision.action === 'reverse') {
    // Processed earlier, now Failed/Refunded: reverse the prior posting.
    await reverseSettlement(base44, tx, tx.amount, ref, decision.status);
  } else if (decision.action === 'fail') {
    // Failed while still pending: no balance change ever occurred.
    await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
      status: 'failed',
      integration_status: 'failed',
      processed_at: new Date().toISOString(),
    });
  }
  // action === 'ignore' -> no change.

  await recordIntegrationEvent(base44, {
    eventType: `seamless.transaction.${decision.action}`,
    aggregateType: 'wallet_transaction',
    aggregateId: tx.id,
    correlationId: tx.id,
    idempotencyKey: idemKey,
    actorType: 'system',
    userId: tx.user_id,
    walletTransactionId: tx.id,
    status: decision.status,
    amount: tx.amount,
    result: status,
    eventData: { provider_ref: providerRef, provider_status: status, action: decision.action },
  });

  return Response.json({ received: true, action: decision.action, status: decision.status });
}

// Posts the balanced ledger for a settled deposit or withdrawal. Deposits credit
// the user's available balance (debit settlement / credit user); withdrawals
// debit the user's available balance (debit user / credit settlement). Uses the
// authoritative postLedgerLegs helper — never a direct balance edit.
async function postSettlement(base44, tx, amount, ref) {
  const groupId = crypto.randomUUID();
  const externalRefType = tx.type === 'deposit' ? 'provider_payment' : 'provider_payout';
  if (tx.type === 'deposit') {
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: tx.id,
      actor: 'system',
      triggerEvent: 'deposit',
      externalRefType,
      externalRefId: ref.external_reference_id,
      legs: [
        { ledgerAccount: 'settlement', debit: amount, credit: 0, transactionType: 'deposit' },
        { ledgerAccount: 'user_account', userId: tx.user_id, debit: 0, credit: amount, transactionType: 'deposit', totalDepositedDelta: amount },
      ],
    });
  } else {
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: tx.id,
      actor: 'system',
      triggerEvent: 'withdrawal',
      externalRefType,
      externalRefId: ref.external_reference_id,
      legs: [
        { ledgerAccount: 'user_account', userId: tx.user_id, debit: amount, credit: 0, transactionType: 'withdrawal', totalWithdrawnDelta: amount },
        { ledgerAccount: 'settlement', debit: 0, credit: amount, transactionType: 'withdrawal' },
      ],
    });
  }
}

// Reverses a prior settlement for a Failed-after-Processed or Refunded event.
// Posts a balanced reversing pair. The original ledger entries are never edited.
async function reverseSettlement(base44, tx, amount, ref, newStatus) {
  const groupId = crypto.randomUUID();
  const externalRefType = tx.type === 'deposit' ? 'provider_refund' : 'provider_reversal';
  if (tx.type === 'deposit') {
    // Deposit reversal: take the credited funds back.
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: tx.id,
      actor: 'system',
      triggerEvent: 'refund',
      externalRefType,
      externalRefId: ref.external_reference_id,
      legs: [
        { ledgerAccount: 'user_account', userId: tx.user_id, debit: amount, credit: 0, transactionType: 'refund', totalDepositedDelta: -amount },
        { ledgerAccount: 'settlement', debit: 0, credit: amount, transactionType: 'refund' },
      ],
    });
  } else {
    // Withdrawal reversal (e.g. failed/returned check): give the funds back.
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: tx.id,
      actor: 'system',
      triggerEvent: 'reversal',
      externalRefType,
      externalRefId: ref.external_reference_id,
      legs: [
        { ledgerAccount: 'settlement', debit: amount, credit: 0, transactionType: 'reversal' },
        { ledgerAccount: 'user_account', userId: tx.user_id, debit: 0, credit: amount, transactionType: 'reversal', totalWithdrawnDelta: -amount },
      ],
    });
  }
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: newStatus || 'reversed',
    integration_status: 'reversed',
    processed_at: new Date().toISOString(),
  });
}