import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { seamlessWithdrawalsEnabled, seamlessRtpPayoutsEnabled } from '../../shared/seamlessFundingConfig.ts';
import { extendComplianceEvidenceRetention } from '../../shared/complianceEvidence.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import { legalNameFromUser } from '../../shared/legalName.ts';
import { isSocureBankVerificationAccepted, latestSocureBankVerification } from '../../shared/socureBankEligibility.js';
import {
  seamlessConfig, seamlessRequest, seamlessBaseUrl, buildWithdrawalBody,
  PATH_CHECK_SEND, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import {
  acquireUserWalletLock, releaseUserWalletLock, claimWithdrawalOperation, saveWithdrawalOperation,
} from '../../shared/seamlessAtomicStore.ts';

const MAX_AMOUNT = 10000;
const SMALL_WITHDRAWAL_THRESHOLD = 10;
const SMALL_WITHDRAWAL_FEE = 2.50;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

async function hasLedgerGroup(base44, groupId) {
  return (await base44.asServiceRole.entities.LedgerEntry.filter({ ledger_group_id: groupId }, '-created_date', 1)).length > 0;
}

async function upsertOperationAudit(base44, fields) {
  const existing = (await base44.asServiceRole.entities.SeamlessOperation.filter(
    { operation_type: 'withdrawal', idempotency_key: fields.idempotency_key }, '-created_date', 1
  ))[0];
  if (existing) return base44.asServiceRole.entities.SeamlessOperation.update(existing.id, { ...fields, updated_at: new Date().toISOString() });
  return base44.asServiceRole.entities.SeamlessOperation.create({ ...fields, operation_type: 'withdrawal', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
}

async function reserveWithdrawal(base44, tx, amount) {
  const groupId = `seamless:withdrawal:reserve:${tx.id}`;
  if (!await hasLedgerGroup(base44, groupId)) {
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: tx.id,
      actor: 'system',
      triggerEvent: 'withdrawal_reservation',
      externalRefType: 'provider_payout',
      externalRefId: tx.id,
      legs: [
        { ledgerAccount: 'user_account', userId: tx.user_id, debit: amount, credit: 0, heldDelta: amount, transactionType: 'withdrawal' },
        { ledgerAccount: 'withdrawal_reserve', debit: 0, credit: amount, transactionType: 'withdrawal' },
      ],
    });
  }
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'pending', integration_status: 'reserved', ledger_group_id: groupId,
    source_event: 'seamless_withdrawal_reservation', processed_at: '',
  });
  return groupId;
}

async function releaseWithdrawalReservation(base44, tx, amount, reason) {
  const groupId = `seamless:withdrawal:release:${tx.id}`;
  if (!await hasLedgerGroup(base44, groupId)) {
    await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: tx.id,
      actor: 'system',
      triggerEvent: 'withdrawal_reservation_release',
      externalRefType: 'provider_payout',
      externalRefId: tx.id,
      legs: [
        { ledgerAccount: 'withdrawal_reserve', debit: amount, credit: 0, transactionType: 'reversal' },
        { ledgerAccount: 'user_account', userId: tx.user_id, debit: 0, credit: amount, heldDelta: -amount, transactionType: 'reversal' },
      ],
    });
  }
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'failed', integration_status: 'failed', source_event: 'seamless_withdrawal_rejected',
    description: `Seamless ACH withdrawal rejected: ${reason}`, processed_at: new Date().toISOString(),
  });
  return groupId;
}

// Reserves available funds before the provider call. The Upstash atomic lock is
// keyed by user, so concurrent Base44 function instances cannot both create a
// withdrawal reservation. The request idempotency key is durable for 90 days.
Deno.serve(async (req) => {
  let lockOwner = '';
  let userId = '';
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!seamlessWithdrawalsEnabled()) {
      return Response.json({
        enabled: false,
        reason: 'Withdrawals are not available yet.',
      }, { status: 409 });
    }
    seamlessConfig(); // fail closed before any provider mutation
    userId = user.id;
    if (!isSocureIdentityVerified(user) || user.withdrawal_hold) {
      return Response.json({ error: 'Your account is not eligible for bank transfers' }, { status: 403 });
    }

    const screeningBanks = await base44.asServiceRole.entities.SeamlessBankAccount.filter({ user_id: user.id, status: 'verified' });
    const screeningBank = screeningBanks.find((item) => item.source_id && item.is_primary) || screeningBanks[0];
    if (!screeningBank?.source_id) {
      return Response.json({ error: 'Link and verify a bank account first', action: 'bank_link_required' }, { status: 400 });
    }
    const bankVerifications = await base44.asServiceRole.entities.SocureBankVerification.filter({ user_id: user.id, source_id: screeningBank.source_id });
    const bankVerification = latestSocureBankVerification(bankVerifications, screeningBank.source_id);
    if (!isSocureBankVerificationAccepted(bankVerification, screeningBank.source_id)) {
      return Response.json({ error: 'Complete bank account screening before withdrawing.', action: 'bank_screening_required' }, { status: 403 });
    }

    const { amount, idempotencyKey } = await req.json();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) {
      return Response.json({ error: 'Invalid withdrawal amount' }, { status: 400 });
    }
    const withdrawalFee = value < SMALL_WITHDRAWAL_THRESHOLD ? SMALL_WITHDRAWAL_FEE : 0;
    const totalDebitAmount = value + withdrawalFee;
    if (!IDEMPOTENCY_KEY.test(String(idempotencyKey || ''))) {
      return Response.json({ error: 'A valid withdrawal idempotency key is required' }, { status: 400 });
    }

    lockOwner = crypto.randomUUID();
    if (!await acquireUserWalletLock(user.id, lockOwner)) {
      return Response.json({ error: 'withdrawal_in_progress', retryable: true }, { status: 409 });
    }

    let operation = await claimWithdrawalOperation(user.id, idempotencyKey, value);
    if (!operation || Number(operation.amount) !== value) {
      return Response.json({ error: 'Invalid withdrawal idempotency key reuse' }, { status: 409 });
    }

    if (operation.state === 'submitted') {
      return Response.json({ enabled: true, transaction_id: operation.wallet_transaction_id, provider_reference_id: operation.provider_reference_id || '', status: 'pending', deduplicated: true });
    }
    if (operation.state === 'submitting' || operation.state === 'uncertain') {
      return Response.json({ enabled: true, transaction_id: operation.wallet_transaction_id || '', status: 'uncertain', deduplicated: true, reconciliation_required: true });
    }
    if (operation.state === 'failed' || operation.state === 'released') {
      return Response.json({ error: 'This withdrawal request was rejected. Start a new request with a new idempotency key.' }, { status: 409 });
    }

    const profile = (await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id }))[0];
    if (!profile?.provider_user_id) {
      return Response.json({ error: 'No Seamless customer profile', action: 'ensure_customer' }, { status: 400 });
    }
    const bank = (await base44.asServiceRole.entities.SeamlessBankAccount.filter({ user_id: user.id, status: 'verified' }))
      .find((item) => item.source_id && item.is_primary) ||
      (await base44.asServiceRole.entities.SeamlessBankAccount.filter({ user_id: user.id, status: 'verified' }))[0];
    if (!bank?.source_id) return Response.json({ error: 'Link and verify a bank account first', action: 'bank_link_required' }, { status: 400 });
    try {
      await extendComplianceEvidenceRetention(base44, {
        userId: user.id,
        fundingSourceId: bank.source_id,
        requireAchAuthorization: false,
      });
    } catch {
      return Response.json({
        error: 'Required retained identity evidence is unavailable.',
        action: 'compliance_evidence_required',
      }, { status: 409 });
    }

    const accountHolderName = legalNameFromUser(user);
    if (!accountHolderName) return Response.json({ error: 'A verified account holder name is required before withdrawal.' }, { status: 400 });
    // RTP is fail-closed: both the server switch and provider-confirmed bank
    // eligibility must be true. Standard speed remains the existing provider
    // default, and no automatic fallback can submit a second payout.
    const transferSpeed = seamlessRtpPayoutsEnabled() && bank.rtp_eligible === true ? 'rtp' : undefined;

    let tx = operation.wallet_transaction_id
      ? await base44.asServiceRole.entities.WalletTransaction.get(operation.wallet_transaction_id)
      : null;
    if (!tx) {
      const wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id }))[0];
      if (!wallet || Number(wallet.available_balance || 0) < value) {
        return Response.json({ error: 'Insufficient available balance' }, { status: 400 });
      }
      tx = await base44.asServiceRole.entities.WalletTransaction.create({
        launch_epoch: 2,
        user_id: user.id, type: 'withdrawal', amount: value,
        description: 'Seamless ACH withdrawal reservation pending',
        status: 'pending', integration_status: 'pending', currency: 'USD', direction: 'reserve',
        source_event: 'seamless_withdrawal_request', initiating_actor: 'user', initiating_actor_id: user.id,
        idempotency_key: idempotencyKey, correlation_id: '', schema_version: 1,
      });
      operation = await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: tx.id, state: 'new' });
    }

    const reservationGroupId = await reserveWithdrawal(base44, tx, value);
    operation = await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: tx.id, reservation_ledger_group_id: reservationGroupId, state: 'reserved' });
    await upsertOperationAudit(base44, {
      user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: tx.id, amount: value,
      status: 'reserved', reservation_ledger_group_id: reservationGroupId, attempts: 1,
    });

    const label = `chessbet-withdrawal-${tx.id}`;
    // Persist the client-known label before the provider request. If the network
    // outcome is unknown, it supports manual/provider reconciliation without a
    // second payout request.
    const existingLabelRef = (await base44.asServiceRole.entities.IntegrationReference.filter({ external_reference_id: label }, '-created_date', 1))[0];
    if (!existingLabelRef) {
      await base44.asServiceRole.entities.IntegrationReference.create({
        provider_key: SEAMLESS_PROVIDER_KEY, reference_type: 'payout', external_reference_id: label,
        internal_entity_type: 'wallet_transaction', internal_entity_id: tx.id, correlation_id: tx.id,
        idempotency_key: idempotencyKey, user_id: user.id, wallet_transaction_id: tx.id,
        status: 'submitting', effective_at: new Date().toISOString(),
        metadata_json: JSON.stringify({ provider: SEAMLESS_PROVIDER_KEY, direction: 'withdrawal', label, source_id: bank.source_id, transfer_speed: transferSpeed || 'standard' }),
      });
    }

    operation = await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: tx.id, reservation_ledger_group_id: reservationGroupId, state: 'submitting', label });
    await base44.asServiceRole.entities.WalletTransaction.update(tx.id, { integration_status: 'submitting', source_event: 'seamless_withdrawal_submitting' });
    await upsertOperationAudit(base44, { user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: tx.id, amount: value, status: 'submitting', reservation_ledger_group_id: reservationGroupId, attempts: 1 });

    let data;
    try {
      data = await seamlessRequest('POST', PATH_CHECK_SEND, buildWithdrawalBody({
        providerUserId: profile.provider_user_id, name: accountHolderName.fullName, amount: value,
        description: 'Withdrawal', label, sourceId: bank.source_id, transferSpeed,
      }));
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status >= 400 && status < 500) {
        const releaseGroupId = await releaseWithdrawalReservation(base44, tx, value, 'provider_rejected');
        await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, state: 'failed', release_ledger_group_id: releaseGroupId });
        await upsertOperationAudit(base44, { user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: tx.id, amount: value, status: 'released', reservation_ledger_group_id: reservationGroupId, attempts: 1, last_error_code: 'provider_rejected' });
        return Response.json({ error: 'Withdrawal submission failed', transaction_id: tx.id }, { status: 400 });
      }
      await base44.asServiceRole.entities.WalletTransaction.update(tx.id, { integration_status: 'uncertain', source_event: 'seamless_withdrawal_uncertain' });
      await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, state: 'uncertain', reconciliation_required: true });
      await upsertOperationAudit(base44, { user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: tx.id, amount: value, status: 'uncertain', reservation_ledger_group_id: reservationGroupId, attempts: 1, last_error_code: 'provider_outcome_unknown' });
      return Response.json({ enabled: true, transaction_id: tx.id, status: 'uncertain', reconciliation_required: true }, { status: 202 });
    }

    const providerRef = data?.check_id || data?.check?.id || data?.id || data?.check?.check_id || '';
    if (!providerRef) {
      await base44.asServiceRole.entities.WalletTransaction.update(tx.id, { integration_status: 'uncertain', source_event: 'seamless_withdrawal_uncertain' });
      await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, state: 'uncertain', reconciliation_required: true });
      return Response.json({ enabled: true, transaction_id: tx.id, status: 'uncertain', reconciliation_required: true }, { status: 202 });
    }

    await base44.asServiceRole.entities.IntegrationReference.create({
      provider_key: SEAMLESS_PROVIDER_KEY, reference_type: 'payout', external_reference_id: providerRef,
      internal_entity_type: 'wallet_transaction', internal_entity_id: tx.id, correlation_id: tx.id,
      idempotency_key: idempotencyKey, user_id: user.id, wallet_transaction_id: tx.id,
      status: 'submitted', effective_at: new Date().toISOString(),
      metadata_json: JSON.stringify({ provider: SEAMLESS_PROVIDER_KEY, direction: 'withdrawal', label, source_id: bank.source_id, transfer_speed: transferSpeed || 'standard',
        endpoint: `${seamlessBaseUrl((Deno.env.get('SEAMLESS_ACH_ENV') || '').trim())}${PATH_CHECK_SEND}` }),
    });
    await base44.asServiceRole.entities.WalletTransaction.update(tx.id, { integration_status: 'submitted', direction: 'reserve', source_event: 'seamless_withdrawal_submitted' });
    await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, state: 'submitted', provider_reference_id: providerRef });
    await upsertOperationAudit(base44, { user_id: user.id, idempotency_key: idempotencyKey, provider_reference_id: providerRef, wallet_transaction_id: tx.id, amount: value, status: 'submitted', reservation_ledger_group_id: reservationGroupId, attempts: 1 });
    await recordIntegrationEvent(base44, {
      eventType: 'financial.seamless_withdrawal_submitted', aggregateType: 'wallet_transaction', aggregateId: tx.id,
      correlationId: tx.id, idempotencyKey: `seamless:withdrawal:submitted:${tx.id}`, actorType: 'user', actorId: user.id,
      userId: user.id, walletTransactionId: tx.id, status: 'pending', amount: value, result: providerRef,
      eventData: { provider: SEAMLESS_PROVIDER_KEY, provider_ref: providerRef, label, transfer_speed: transferSpeed || 'standard' },
    });
    return Response.json({ enabled: true, transaction_id: tx.id, provider_reference_id: providerRef, status: 'pending', transfer_speed: transferSpeed || 'standard' });
  } catch {
    return Response.json({ error: 'Unable to submit withdrawal' }, { status: 503 });
  } finally {
    if (userId && lockOwner) {
      try { await releaseUserWalletLock(userId, lockOwner); } catch { /* TTL safely releases an unavailable store lock. */ }
    }
  }
});
