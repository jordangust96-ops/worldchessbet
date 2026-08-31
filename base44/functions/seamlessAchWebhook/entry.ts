import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  verifySeamlessWebhookAuth, webhookIdempotencyKey, mapTransactionStatus,
  applyWebhookEvent, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { claimWebhookEvent, finishWebhookEvent } from '../../shared/seamlessAtomicStore.ts';

function pickCheckId(body) { return body?.check?.id || body?.check?.check_id || body?.check_id || body?.id || ''; }
function pickSourceId(body) { return body?.source?.id || body?.source_id || body?.funding_source?.id || body?.fundingSourceId || ''; }
function pickLabel(body) { return body?.check?.label || body?.label || body?.transaction?.label || ''; }
function pickEventType(body) { return body?.event || body?.event_type || body?.type || ''; }
function pickEventId(body) { return body?.event_id || body?.webhook_id || ''; }
function pickStatus(body) { return body?.status || body?.check?.status || ''; }
function pickAmount(body) {
  const value = Number(body?.amount ?? body?.check?.amount);
  return Number.isFinite(value) ? value / 100 : undefined;
}
async function hasLedgerGroup(base44, groupId) {
  return (await base44.asServiceRole.entities.LedgerEntry.filter({ ledger_group_id: groupId }, '-created_date', 1)).length > 0;
}

Deno.serve(async (req) => {
  if (!verifySeamlessWebhookAuth(req.headers.get('authorization'))) return new Response('Unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const eventType = pickEventType(body);
  const eventId = pickEventId(body);
  const providerRef = pickCheckId(body) || pickSourceId(body) || pickLabel(body);
  const providerStatus = pickStatus(body);
  const idemKey = webhookIdempotencyKey({ eventId, providerRef, eventType, status: providerStatus, timestamp: body?.timestamp || '' });
  const owner = crypto.randomUUID();

  try {
    const claim = await claimWebhookEvent(idemKey, providerRef, owner);
    if (claim?.claim === 'completed') return Response.json({ received: true, deduplicated: true });
    if (claim?.claim === 'busy' || claim?.claim === 'transaction_busy') {
      return Response.json({ error: 'webhook_retryable' }, { status: 503 });
    }
    if (claim?.claim !== 'owned') return Response.json({ error: 'webhook_claim_failed' }, { status: 503 });

    const base44 = createClientFromRequest(req);
    let result;
    if (eventType.startsWith('funding-source.')) {
      result = await handleFundingSource(base44, body, eventType, idemKey);
    } else if (eventType === 'transaction.status' || eventType.startsWith('transaction.') || eventType === 'check.status' || eventType === 'status') {
      result = await handleTransaction(base44, body, eventType, idemKey, providerRef);
    } else {
      await recordIntegrationEvent(base44, {
        eventType: `seamless.webhook.unknown:${eventType || 'unknown'}`,
        aggregateType: 'ledger_group', aggregateId: providerRef || eventId || idemKey,
        correlationId: providerRef || eventId || idemKey, idempotencyKey: `audit:${idemKey}`,
        actorType: 'system', status: 'ignored',
        eventData: { event_type: eventType, provider_ref: providerRef, provider_status: providerStatus },
      });
      result = { received: true, ignored: true };
    }

    await finishWebhookEvent(idemKey, providerRef, owner, 'completed');
    return Response.json(result);
  } catch {
    try { await finishWebhookEvent(idemKey, providerRef, owner, 'retryable', 'processing_failed'); } catch { /* provider retry remains safest */ }
    return Response.json({ error: 'webhook_processing_failed' }, { status: 500 });
  }
});

async function handleFundingSource(base44, body, eventType, idemKey) {
  const statusMap = {
    'funding-source.added': 'added', 'funding-source.updated': 'added',
    'funding-source.pending-verification': 'pending_verification', 'funding-source.verified': 'verified',
    'funding-source.verification-failed': 'verification_failed', 'funding-source.verification-expired': 'verification_expired',
    'funding-source.deleted': 'deleted', 'funding-source.made-primary': 'verified',
  };
  const sourceId = pickSourceId(body) || pickCheckId(body);
  const providerUserId = body?.user_id || body?.user?.id || '';
  let bank = sourceId ? (await base44.asServiceRole.entities.SeamlessBankAccount.filter({ source_id: sourceId }))[0] : null;
  if (!bank && providerUserId) bank = (await base44.asServiceRole.entities.SeamlessBankAccount.filter({ provider_user_id: providerUserId }))[0];
  if (bank) {
    const updates = { status: statusMap[eventType] || 'added' };
    if (updates.status === 'verified') updates.verified_at = new Date().toISOString();
    if (eventType === 'funding-source.made-primary') updates.is_primary = true;
    await base44.asServiceRole.entities.SeamlessBankAccount.update(bank.id, updates);
  }
  await recordIntegrationEvent(base44, {
    eventType: `seamless.${eventType}`, aggregateType: 'wallet', aggregateId: bank?.user_id || providerUserId || sourceId || idemKey,
    correlationId: sourceId || providerUserId || idemKey, idempotencyKey: `audit:${idemKey}`, actorType: 'system',
    userId: bank?.user_id || '', status: statusMap[eventType] || 'added',
    eventData: { source_id: sourceId, provider_user_id: providerUserId, bank_id: bank?.id || '' },
  });
  return { received: true, applied: true };
}

async function findReference(base44, providerRef, label) {
  if (providerRef) {
    const byProvider = (await base44.asServiceRole.entities.IntegrationReference.filter({ external_reference_id: providerRef }))[0];
    if (byProvider) return byProvider;
  }
  if (label) return (await base44.asServiceRole.entities.IntegrationReference.filter({ external_reference_id: label }))[0] || null;
  return null;
}

async function handleTransaction(base44, body, eventType, idemKey, providerRef) {
  const providerStatus = pickStatus(body);
  const label = pickLabel(body);
  const ref = await findReference(base44, providerRef, label);
  if (!ref?.wallet_transaction_id) {
    // This record is durable in the atomic store before this point. We do not
    // fabricate a match or touch any wallet; returning 500 requests provider
    // retry because a just-created local reference may not yet be visible.
    await recordIntegrationEvent(base44, {
      eventType: `seamless.${eventType || 'transaction'}.unmatched`,
      aggregateType: 'ledger_group', aggregateId: providerRef || label || idemKey,
      correlationId: providerRef || label || idemKey, idempotencyKey: `audit:${idemKey}`,
      actorType: 'system', status: 'retryable', amount: pickAmount(body),
      eventData: { provider_ref: providerRef, label, provider_status: providerStatus },
    });
    throw new Error('unmatched_provider_transaction');
  }

  const tx = await base44.asServiceRole.entities.WalletTransaction.get(ref.wallet_transaction_id);
  if (!tx) throw new Error('missing_wallet_transaction');

  const decision = applyWebhookEvent(tx, { status: providerStatus });
  if (decision.action === 'post') await postSettlement(base44, tx, Number(tx.amount), ref, providerRef || label);
  else if (decision.action === 'reverse') await reverseSettlement(base44, tx, Number(tx.amount), ref, providerRef || label);
  else if (decision.action === 'fail') {
    if (tx.type === 'withdrawal') await releaseWithdrawal(base44, tx, Number(tx.amount), providerRef || label);
    else await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
      status: decision.status, integration_status: 'failed', processed_at: new Date().toISOString(),
    });
  }

  await recordIntegrationEvent(base44, {
    eventType: `seamless.transaction.${decision.action}`, aggregateType: 'wallet_transaction', aggregateId: tx.id,
    correlationId: tx.id, idempotencyKey: `audit:${idemKey}`, actorType: 'system', userId: tx.user_id,
    walletTransactionId: tx.id, status: decision.status, amount: tx.amount, result: providerStatus,
    eventData: { provider_ref: providerRef, label, provider_status: providerStatus, action: decision.action },
  });
  return { received: true, action: decision.action, status: decision.status };
}

async function postSettlement(base44, tx, amount, ref, providerRef) {
  const groupId = tx.type === 'deposit' ? `seamless:deposit:settle:${tx.id}` : `seamless:withdrawal:settle:${tx.id}`;
  if (!await hasLedgerGroup(base44, groupId)) {
    if (tx.type === 'deposit') {
      await postLedgerLegs(base44, {
        groupId, walletTransactionId: tx.id, actor: 'system', triggerEvent: 'deposit',
        externalRefType: 'provider_payment', externalRefId: providerRef,
        legs: [
          { ledgerAccount: 'settlement', debit: amount, credit: 0, transactionType: 'deposit' },
          { ledgerAccount: 'user_account', userId: tx.user_id, debit: 0, credit: amount, transactionType: 'deposit', totalDepositedDelta: amount },
        ],
      });
    } else {
      // The user debit occurred at reservation time. Processed transfers the
      // held reserve to settlement; it must not debit available funds again.
      await postLedgerLegs(base44, {
        groupId, walletTransactionId: tx.id, actor: 'system', triggerEvent: 'withdrawal',
        externalRefType: 'provider_payout', externalRefId: providerRef,
        legs: [
          { ledgerAccount: 'withdrawal_reserve', debit: amount, credit: 0, transactionType: 'withdrawal' },
          { ledgerAccount: 'settlement', debit: 0, credit: amount, transactionType: 'withdrawal' },
          { ledgerAccount: 'user_account', userId: tx.user_id, debit: 0, credit: 0, heldDelta: -amount, transactionType: 'withdrawal', totalWithdrawnDelta: amount },
        ],
      });
    }
  }
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'completed', integration_status: 'settled', ledger_group_id: groupId, processed_at: new Date().toISOString(),
  });
}

async function releaseWithdrawal(base44, tx, amount, providerRef) {
  const groupId = `seamless:withdrawal:release:${tx.id}`;
  if (!await hasLedgerGroup(base44, groupId)) {
    await postLedgerLegs(base44, {
      groupId, walletTransactionId: tx.id, actor: 'system', triggerEvent: 'withdrawal_reservation_release',
      externalRefType: 'provider_payout', externalRefId: providerRef,
      legs: [
        { ledgerAccount: 'withdrawal_reserve', debit: amount, credit: 0, transactionType: 'reversal' },
        { ledgerAccount: 'user_account', userId: tx.user_id, debit: 0, credit: amount, heldDelta: -amount, transactionType: 'reversal' },
      ],
    });
  }
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'failed', integration_status: 'failed', ledger_group_id: groupId, processed_at: new Date().toISOString(),
  });
}

async function reverseSettlement(base44, tx, amount, ref, providerRef) {
  const groupId = tx.type === 'deposit' ? `seamless:deposit:reverse:${tx.id}` : `seamless:withdrawal:reverse:${tx.id}`;
  if (!await hasLedgerGroup(base44, groupId)) {
    if (tx.type === 'deposit') {
      await postLedgerLegs(base44, {
        groupId, walletTransactionId: tx.id, actor: 'system', triggerEvent: 'refund',
        externalRefType: 'provider_refund', externalRefId: providerRef,
        legs: [
          { ledgerAccount: 'user_account', userId: tx.user_id, debit: amount, credit: 0, transactionType: 'refund', totalDepositedDelta: -amount },
          { ledgerAccount: 'settlement', debit: 0, credit: amount, transactionType: 'refund' },
        ],
      });
    } else {
      await postLedgerLegs(base44, {
        groupId, walletTransactionId: tx.id, actor: 'system', triggerEvent: 'reversal',
        externalRefType: 'provider_reversal', externalRefId: providerRef,
        legs: [
          { ledgerAccount: 'settlement', debit: amount, credit: 0, transactionType: 'reversal' },
          { ledgerAccount: 'user_account', userId: tx.user_id, debit: 0, credit: amount, transactionType: 'reversal', totalWithdrawnDelta: -amount },
        ],
      });
    }
  }
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'reversed', integration_status: 'reversed', ledger_group_id: groupId, processed_at: new Date().toISOString(),
  });
}
