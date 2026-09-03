import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  verifySeamlessWebhookAuth, webhookIdempotencyKey, mapTransactionStatus,
  applyWebhookEvent, applyFundingSourceEvent, normalizeProviderEventTime,
  SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { claimWebhookEvent, finishWebhookEvent } from '../../shared/seamlessAtomicStore.ts';

function pickCheckId(body) { return body?.check?.id || body?.check?.check_id || body?.check_id || body?.id || ''; }
function pickSourceId(body) { return body?.source?.id || body?.source_id || body?.funding_source?.id || body?.funding_source_id || body?.fundingSourceId || ''; }
function pickCustomerId(body) { return body?.customer_id || body?.user_id || body?.user?.id || body?.customer?.id || ''; }
function pickLabel(body) { return body?.check?.label || body?.label || body?.transaction?.label || ''; }
function pickEventType(body) { return body?.event || body?.event_type || body?.type || ''; }
function pickEventId(body) { return body?.event_id || body?.webhook_id || ''; }
function pickStatus(body) { return body?.status || body?.check?.status || ''; }
function isMerchantBalanceTransaction(body, eventType) {
  if (eventType !== 'transaction.status' || pickLabel(body)) return false;
  const check = body?.check || body?.transaction || {};
  const description = String(check?.description || body?.description || '').trim().toLowerCase();
  const senderBank = String(check?.sndr_bname || check?.sender_bank_name || '').trim().toLowerCase();
  const recipientBank = String(check?.rec_bname || check?.recipient_bank_name || '').trim().toLowerCase();
  return description === 'transfer to balance' || description === 'transfer from balance' ||
    senderBank === 'balance' || recipientBank === 'balance';
}
function pickRtpEligibility(body) {
  const candidates = [
    body?.rtp_eligible, body?.supports_rtp, body?.source?.rtp_eligible,
    body?.source?.supports_rtp, body?.funding_source?.rtp_eligible,
    body?.funding_source?.supports_rtp,
  ];
  return candidates.find((value) => typeof value === 'boolean') ?? null;
}
function pickAmount(body) {
  const value = Number(body?.amount ?? body?.check?.amount);
  return Number.isFinite(value) ? value / 100 : undefined;
}
async function hasLedgerGroup(base44, groupId) {
  return (await base44.asServiceRole.entities.LedgerEntry.filter({ ledger_group_id: groupId }, '-created_date', 1)).length > 0;
}

// Seamless sends its own secret directly in Authorization (no "Bearer "
// scheme -- see verifySeamlessWebhookAuth above, which is what actually
// authenticates this request). createClientFromRequest, however, throws on
// any non-empty Authorization header that isn't "Bearer <token>" shaped,
// regardless of whether a user token is even needed. Every handler below
// only ever uses base44.asServiceRole, so the incoming Authorization header
// is never needed for identity -- strip it before handing the request to the
// SDK so a provider's own auth scheme can never crash client construction.
function serviceClientForWebhook(req) {
  const headers = new Headers(req.headers);
  headers.delete('authorization');
  return createClientFromRequest({ headers });
}

Deno.serve(async (req) => {
  if (!verifySeamlessWebhookAuth(req.headers.get('authorization'))) return new Response('Unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const eventType = pickEventType(body);
  // Seamless endpoint probes carry no business state and intentionally omit a
  // provider reference/event id. Acknowledge them after authentication instead
  // of collapsing every probe into the same financial idempotency record.
  if (eventType === 'endpoint.test') return Response.json({ received: true, test: true });

  const eventId = pickEventId(body);
  const providerRef = eventType.startsWith('funding-source.')
    ? (pickSourceId(body) || pickCustomerId(body) || eventId)
    : (pickCheckId(body) || pickSourceId(body) || pickLabel(body));
  const providerStatus = pickStatus(body);
  const idemKey = webhookIdempotencyKey({ eventId, providerRef, eventType, status: providerStatus, timestamp: body?.timestamp || '' });

  // Merchant balance transfers are account-level treasury activity, not a
  // player WalletTransaction: they never touch the ledger or a wallet lock,
  // and recordIntegrationEvent is already idempotent on idempotencyKey. Handle
  // them before the atomic-store claim so an unreachable/misconfigured Redis
  // cannot turn these harmless, self-deduplicating audit events into 500s that
  // burn through the provider's webhook retry budget (this is what was
  // happening: Seamless disables the endpoint after enough failed retries).
  if (isMerchantBalanceTransaction(body, eventType)) {
    // Best-effort audit write. A failure here (schema drift, transient DB
    // error, etc.) must never turn a harmless, non-financial notification
    // into a 500 that burns the provider's retry budget or a raw worker
    // crash — Seamless only needs a 2xx to stop retrying this event.
    let auditError = '';
    try {
      const base44 = serviceClientForWebhook(req);
      await recordIntegrationEvent(base44, {
        eventType: 'seamless.merchant_balance.transaction_status',
        aggregateType: 'ledger_group', aggregateId: providerRef || idemKey,
        correlationId: providerRef || idemKey, idempotencyKey: `audit:${idemKey}`,
        actorType: 'system', status: providerStatus || 'received', amount: pickAmount(body),
        result: 'merchant_balance_ignored',
        eventData: {
          provider_ref: providerRef, provider_status: providerStatus,
          direction: body?.check?.direction || body?.direction || '',
          description: body?.check?.description || body?.description || '',
        },
      });
    } catch (e) {
      auditError = String(e?.message || e);
      console.error(JSON.stringify({ event: 'merchant_balance_audit_failed', provider_ref: providerRef, error: auditError }));
    }
    return Response.json({
      received: true, applied: false, ignored: true, category: 'merchant_balance',
      ...(auditError ? { audit_error: auditError } : {}),
    });
  }

  const owner = crypto.randomUUID();

  try {
    const claim = await claimWebhookEvent(idemKey, providerRef, owner);
    if (claim?.claim === 'completed') return Response.json({ received: true, deduplicated: true });
    if (claim?.claim === 'busy' || claim?.claim === 'transaction_busy') {
      return Response.json({ error: 'webhook_retryable' }, { status: 503 });
    }
    if (claim?.claim !== 'owned') return Response.json({ error: 'webhook_claim_failed' }, { status: 503 });

    const base44 = serviceClientForWebhook(req);
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

const FUNDING_SOURCE_EVENTS = new Set([
  'funding-source.added',
  'funding-source.updated',
  'funding-source.pending-verification',
  'funding-source.verified',
  'funding-source.verification-failed',
  'funding-source.verification-expired',
  'funding-source.deleted',
  'funding-source.made-primary',
  'funding-source.made-billing',
]);

function safeLastFour(body) {
  const candidate =
    body?.last_four ?? body?.account_mask ?? body?.source?.last_four ??
    body?.funding_source?.last_four ?? '';
  const digits = String(candidate).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

function safeAccountName(body) {
  const candidate =
    body?.institution?.name ?? body?.bank_name ?? body?.source?.bank_name ??
    body?.funding_source?.bank_name ?? body?.source?.nickname ?? '';
  return String(candidate || '').trim().slice(0, 160);
}

async function auditFundingSource(base44, {
  eventType, idemKey, sourceId, providerUserId, bank, profile, status, result, reason,
}) {
  await recordIntegrationEvent(base44, {
    eventType: `seamless.${eventType || 'funding-source.unknown'}`,
    aggregateType: 'wallet',
    aggregateId: bank?.user_id || profile?.user_id || providerUserId || sourceId || idemKey,
    correlationId: sourceId || providerUserId || idemKey,
    idempotencyKey: `audit:${idemKey}`,
    actorType: 'system',
    userId: bank?.user_id || profile?.user_id || '',
    status,
    result,
    eventData: {
      provider: SEAMLESS_PROVIDER_KEY,
      source_id: sourceId,
      provider_user_id: providerUserId,
      bank_id: bank?.id || '',
      profile_id: profile?.id || '',
      reason,
    },
  });
}

async function handleFundingSource(base44, body, eventType, idemKey) {
  const sourceId = pickSourceId(body);
  const providerUserId = pickCustomerId(body);
  const eventId = pickEventId(body);
  const eventTime = body?.timestamp || body?.occurred_at || '';

  if (!FUNDING_SOURCE_EVENTS.has(eventType)) {
    await auditFundingSource(base44, {
      eventType, idemKey, sourceId, providerUserId,
      status: 'ignored', result: 'unsupported_event', reason: 'unsupported_event',
    });
    return { received: true, applied: false, ignored: true };
  }

  const profiles = providerUserId
    ? await base44.asServiceRole.entities.SeamlessPaymentProfile.filter(
        { provider_user_id: providerUserId }, '-created_date', 2
      )
    : [];
  const profile = profiles.length === 1 && profiles[0].provider_key === SEAMLESS_PROVIDER_KEY
    ? profiles[0]
    : null;

  if (!profile) {
    await auditFundingSource(base44, {
      eventType, idemKey, sourceId, providerUserId,
      status: 'unmatched', result: 'ownership_unmatched',
      reason: providerUserId ? (profiles.length > 1 ? 'ambiguous_customer' : 'unknown_customer') : 'missing_customer_id',
    });
    return { received: true, applied: false, unmatched: true };
  }

  // Pending-verification callbacks may intentionally omit source_id. A
  // provider customer alone is not enough to select one of multiple banks, so
  // retain the audit signal and wait for a later identified source event.
  if (!sourceId) {
    await auditFundingSource(base44, {
      eventType, idemKey, sourceId, providerUserId, profile,
      status: 'pending', result: 'awaiting_source_id', reason: 'missing_source_id',
    });
    return { received: true, applied: false, awaiting_source_id: true };
  }

  const banks = await base44.asServiceRole.entities.SeamlessBankAccount.filter(
    { source_id: sourceId }, '-created_date', 2
  );
  if (banks.length > 1) {
    await auditFundingSource(base44, {
      eventType, idemKey, sourceId, providerUserId, profile,
      status: 'unmatched', result: 'duplicate_source_records', reason: 'ambiguous_source',
    });
    return { received: true, applied: false, unmatched: true };
  }

  let bank = banks[0] || null;
  if (bank && (
    bank.user_id !== profile.user_id ||
    (bank.profile_id && bank.profile_id !== profile.id) ||
    (bank.provider_user_id && bank.provider_user_id !== providerUserId)
  )) {
    await auditFundingSource(base44, {
      eventType, idemKey, sourceId, providerUserId, bank, profile,
      status: 'unmatched', result: 'ownership_conflict', reason: 'source_profile_mismatch',
    });
    return { received: true, applied: false, unmatched: true };
  }

  const decision = applyFundingSourceEvent(bank, { eventType, timestamp: eventTime });
  const accountName = safeAccountName(body);
  const accountMask = safeLastFour(body);
  const rtpEligible = pickRtpEligibility(body);
  const providerEventAt = normalizeProviderEventTime(eventTime);
  const now = new Date().toISOString();

  if (!bank) {
    const initialStatus = decision.status || 'added';
    const createFields = {
      user_id: profile.user_id,
      source_id: sourceId,
      profile_id: profile.id,
      provider_user_id: providerUserId,
      account_name: accountName,
      account_mask: accountMask,
      is_primary: eventType === 'funding-source.made-primary',
      rtp_eligible: rtpEligible === true,
      rtp_eligibility_source: rtpEligible == null ? 'unknown' : 'provider_webhook',
      status: initialStatus,
      added_at: providerEventAt || now,
    };
    if (initialStatus === 'verified') createFields.verified_at = providerEventAt || now;
    if (rtpEligible != null) createFields.rtp_eligibility_checked_at = providerEventAt || now;
    if (providerEventAt) createFields.provider_event_at = providerEventAt;
    if (eventId) createFields.last_provider_event_id = eventId;
    bank = await base44.asServiceRole.entities.SeamlessBankAccount.create(createFields);
  } else if (decision.action === 'apply' || decision.action === 'metadata') {
    const updates = {};
    if (!bank.profile_id) updates.profile_id = profile.id;
    if (!bank.provider_user_id) updates.provider_user_id = providerUserId;
    if (decision.action === 'apply') {
      updates.status = decision.status;
      if (providerEventAt) updates.provider_event_at = providerEventAt;
      if (eventId) updates.last_provider_event_id = eventId;
      if (decision.status === 'verified') updates.verified_at = providerEventAt || now;
      if (['verification_failed', 'verification_expired', 'deleted'].includes(decision.status)) {
        updates.is_primary = false;
      }
    }
    if (decision.action === 'metadata') {
      if (decision.providerEventAt) updates.provider_event_at = decision.providerEventAt;
      if (eventId) updates.last_provider_event_id = eventId;
    }
    if (accountName) updates.account_name = accountName;
    if (accountMask) updates.account_mask = accountMask;
    if (eventType === 'funding-source.made-primary' && decision.action === 'metadata') updates.is_primary = true;
    if (rtpEligible != null) {
      updates.rtp_eligible = rtpEligible;
      updates.rtp_eligibility_source = 'provider_webhook';
      updates.rtp_eligibility_checked_at = providerEventAt || now;
    }
    if (Object.keys(updates).length > 0) {
      bank = await base44.asServiceRole.entities.SeamlessBankAccount.update(bank.id, updates);
    }
  }

  await auditFundingSource(base44, {
    eventType, idemKey, sourceId, providerUserId, bank, profile,
    status: bank.status, result: decision.action, reason: decision.reason,
  });
  return {
    received: true,
    applied: ['apply', 'metadata'].includes(decision.action) || !banks[0],
    bank_status: bank.status,
    stale: decision.reason === 'stale_event',
  };
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
