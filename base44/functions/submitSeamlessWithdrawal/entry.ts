import { buildVerifiedWithdrawalBody, DEFINITE_DESTINATION_REASONS, isDefinitePreflightRejection } from '../../shared/verifiedWithdrawalBody.ts';
import { estimateQueuedWithdrawal, queuedWithdrawalReady } from '../../shared/withdrawalQueue.ts';
import { settleQueuedWithdrawalFee } from '../../shared/queuedWithdrawalFee.ts';
import { sendWithdrawalRequestedEmail } from '../../shared/withdrawalRequestedEmail.ts';
import { walletFundingSummary } from '../../shared/fundingProvenance.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { seamlessWithdrawalsEnabled, seamlessRtpPayoutsEnabled } from '../../shared/seamlessFundingConfig.ts';
import { extendComplianceEvidenceRetention } from '../../shared/complianceEvidence.ts';
import { hasVerifiedIdentity } from '../../shared/identityEligibility.js';
import { legalNameFromUser } from '../../shared/legalName.ts';
import {
  seamlessConfig, seamlessRequest, seamlessBaseUrl, buildWithdrawalBody,
  PATH_CHECK_SEND, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import {
  acquireUserWalletLock, releaseUserWalletLock, claimWithdrawalOperation, saveWithdrawalOperation,
} from '../../shared/seamlessAtomicStore.ts';

import { sendLimitedWithdrawal } from '../../shared/limitedWithdrawal.ts';
import { MAX_WITHDRAWAL_AMOUNT, withdrawalCents } from '../../shared/withdrawalLimits.js';
const MAX_AMOUNT = MAX_WITHDRAWAL_AMOUNT;
const SMALL_WITHDRAWAL_THRESHOLD = 10;
const SMALL_WITHDRAWAL_FEE = 2.50;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

// Distinct user/admin messaging for each definitive preflight outcome. Never
// describe preflight, review, or reconnect conditions as provider rejection.
const WITHDRAWAL_PREFLIGHT_MESSAGES = {
  withdrawal_destination_changed: 'The bank account selected for this withdrawal no longer matches your current primary bank. Start a new withdrawal after confirming your bank.',
  withdrawal_destination_missing: 'The bank account saved for this withdrawal is no longer available. Confirm your bank before starting a new request.',
  withdrawal_destination_multiple_primary: 'Conflicting records were found for the bank account saved for this withdrawal. Contact support before withdrawing.',
  withdrawal_destination_deleted: 'The bank account selected for this withdrawal has been removed. Reconnect a bank and try again.',
  withdrawal_destination_reconnect_required: 'The bank account selected for this withdrawal needs to be reconnected. Reconnect your bank and try again.',
  withdrawal_merchant_unavailable: 'ChessBet payment account is temporarily unavailable for withdrawals. Please try again later.',
  withdrawal_merchant_balance_unavailable: 'ChessBet payment funding is temporarily unavailable for withdrawals. Please try again later.',
};

async function readOperationAudit(base44, fields) {
  const rows = await base44.asServiceRole.entities.SeamlessOperation.filter(
    { operation_type: 'withdrawal', user_id: fields.user_id, idempotency_key: fields.idempotency_key }, '-created_date', 2
  );
  if (!Array.isArray(rows) || rows.length > 1) throw Error('withdrawal_operation_read_indeterminate');
  const existing = rows[0];
  if (existing && fields.wallet_transaction_id && existing.wallet_transaction_id !== fields.wallet_transaction_id) {
    throw Error('withdrawal_operation_identity_conflict');
  }
  return existing;
}

async function upsertOperationAudit(base44, fields) {
  const existing = await readOperationAudit(base44, fields);
  if (existing) return base44.asServiceRole.entities.SeamlessOperation.update(existing.id, { ...fields, updated_at: new Date().toISOString() });
  return base44.asServiceRole.entities.SeamlessOperation.create({ ...fields, operation_type: 'withdrawal', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
}

async function reserveWithdrawal(base44, tx, amount, withdrawalFee = 0) {
  const queued=!!tx.withdrawal_requested_at;
  amount = queued ? amount + Number(tx.withdrawal_request_fee || 0) : amount;
  const groupId = `seamless:withdrawal:reserve:${tx.id}`;
  await postLedgerLegs(base44, {
      groupId,
      walletTransactionId: tx.id,
      actor: 'system',
      triggerEvent: queued ? 'withdrawal_request_reservation' : 'withdrawal_reservation',
      updateTransactions: false,
      withdrawalFee,
      externalRefType: 'provider_payout',
      externalRefId: tx.id,
      legs: [
        { ledgerAccount: 'user_account', userId: tx.user_id, debit: amount, credit: 0, heldDelta: amount, transactionType: 'withdrawal' },
        { ledgerAccount: 'withdrawal_reserve', debit: 0, credit: amount, transactionType: 'withdrawal' },
      ],
    });
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'pending', integration_status: 'reserved', ledger_group_id: groupId,
    source_event: 'seamless_withdrawal_reservation', processed_at: '',
  });
  return groupId;
}

export async function releaseWithdrawalReservation(base44, tx, amount, reason, userMessage, operation = {}) {
  const groupId = `seamless:withdrawal:release:${tx.id}`;
  const identity = { user_id: tx.user_id, idempotency_key: tx.idempotency_key, wallet_transaction_id: tx.id, amount };
  const assertSafe = async () => {
    const fresh = await base44.asServiceRole.entities.WalletTransaction.get(tx.id);
    const audit = await readOperationAudit(base44, identity);
    const protectedStates = ['submitted', 'processing', 'completed', 'succeeded', 'settled', 'uncertain', 'ambiguous', 'review_required', 'reversed'];
    if (!fresh || fresh.user_id !== tx.user_id || fresh.idempotency_key !== tx.idempotency_key || Number(fresh.amount) !== amount ||
        protectedStates.includes(fresh.status) || protectedStates.includes(fresh.integration_status) ||
        fresh.withdrawal_request_status === 'review_required' || fresh.provider_last_status ||
        audit?.provider_reference_id || protectedStates.includes(audit?.status) || operation.provider_reference_id ||
        protectedStates.includes(operation.state) ||
        (audit?.release_ledger_group_id && (audit.release_ledger_group_id !== groupId || audit.last_error_code !== reason)) ||
        (fresh.status === 'failed' && (fresh.source_event !== 'seamless_withdrawal_not_completed' || !fresh.description?.includes(`[${reason}]`)))) {
      throw Error('withdrawal_release_evidence_conflict');
    }
    return { fresh, audit };
  };
  const { fresh, audit } = await assertSafe();
  // Write recoverable intent before money moves. Never masquerade it as an
  // ambiguous provider outcome; replay is safe only for this exact release.
  await upsertOperationAudit(base44, { ...identity, status: audit?.status || 'reserved',
    release_ledger_group_id: groupId, last_error_code: reason, last_error_message: userMessage });
  await postLedgerLegs(base44, {
    groupId, walletTransactionId: tx.id, actor: 'system', triggerEvent: 'withdrawal_reservation_release',
    updateTransactions: false, beforePost: async () => { await assertSafe(); return true; },
    externalRefType: 'provider_payout', externalRefId: tx.id,
    legs: [
      { ledgerAccount: 'withdrawal_reserve', debit: amount, credit: 0, transactionType: 'reversal' },
      { ledgerAccount: 'user_account', userId: tx.user_id, debit: 0, credit: amount, heldDelta: -amount, transactionType: 'reversal' },
    ],
  });
  if (tx.withdrawal_requested_at) await settleQueuedWithdrawalFee(base44, tx, true);
  await assertSafe();
  const completedAt = audit?.completed_at || (fresh.status === 'failed' && fresh.processed_at) || new Date().toISOString();
  // Complete both operation stores BEFORE exposing a failed/released wallet.
  // A crash at any boundary resumes from the durable intent without a POST.
  await saveWithdrawalOperation(tx.user_id, tx.idempotency_key, { ...operation, amount,
    wallet_transaction_id: tx.id, state: 'released', release_ledger_group_id: groupId,
    last_error_code: reason, last_error_message: userMessage, completed_at: completedAt, updated_at: completedAt });
  await upsertOperationAudit(base44, { ...identity, status: 'released', release_ledger_group_id: groupId,
    last_error_code: reason, last_error_message: userMessage, completed_at: completedAt });
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
    status: 'failed', integration_status: 'failed', ledger_group_id: groupId, direction: 'release',
    source_event: 'seamless_withdrawal_not_completed',
    ...(tx.withdrawal_requested_at ? { withdrawal_request_status: 'failed' } : {}),
    description: `${userMessage} [${reason}]`, processed_at: completedAt,
  });
  return groupId;
}

// Reserves available funds before the provider call; capacity uses the server clock. The Upstash atomic lock is
// keyed by user, so concurrent Base44 function instances cannot both create a
// withdrawal reservation. The request idempotency key is durable for 90 days.
Deno.serve(async (req) => {
  let lockOwner = '';
  let userId = '';
  let failureStage = 'validation';
  let diagnosticTransactionId = '';
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const input=await req.json();
    const processingQueue=!!input.queuedTransactionId;
    const providerNoPaymentConfirmed = input.providerNoPaymentConfirmed === true;
    if(processingQueue&&caller.role!=='admin')return Response.json({error:'Forbidden'},{status:403});
    if(providerNoPaymentConfirmed&&caller.role!=='admin')return Response.json({error:'Forbidden'},{status:403});
    const queuedTx=processingQueue?await base44.asServiceRole.entities.WalletTransaction.get(input.queuedTransactionId):null;
    if(processingQueue&&(!queuedTx||queuedTx.type!=='withdrawal'||!queuedTx.withdrawal_requested_at))return Response.json({error:'invalid_queued_request'},{status:400});
    const user=processingQueue?await base44.asServiceRole.entities.User.get(queuedTx.user_id):caller;
    const amount=processingQueue?queuedTx.amount:input.amount;
    const idempotencyKey=processingQueue?queuedTx.idempotency_key:input.idempotencyKey;
    if (!seamlessWithdrawalsEnabled()) {
      return Response.json({
        enabled: false,
        reason: 'Withdrawals are not available yet.',
      }, { status: 409 });
    }
    seamlessConfig(); // fail closed before any provider mutation
    userId = user.id;
    if (!await hasVerifiedIdentity(base44, user) || (processingQueue && user.withdrawal_hold)) {
      return Response.json({ error: 'Identity verification (21+) is required and account holds must be resolved before transfers. Contact hello@worldchessbet.com for help accessing existing funds.' }, { status: 403 });
    }

    // An unverified funding source can receive credits/direct deposits; only
    // deleted is excluded from the initial selection. The authoritative
    // destination check runs in buildVerifiedWithdrawalBody (preflight).
    const allBanks = await base44.asServiceRole.entities.SeamlessBankAccount.filter({ user_id: user.id });
    const saved=(await base44.asServiceRole.entities.WalletTransaction.filter({user_id:user.id,type:'withdrawal',idempotency_key:idempotencyKey},'-created_date',2));
    if(saved.length>1)throw Error('duplicate_withdrawal_request');
    const prior=queuedTx||saved[0];
    if(prior&&Number(prior.amount)!==Number(amount))return Response.json({error:'Invalid withdrawal idempotency key reuse'},{status:409});
    const creditEligible = allBanks.filter(b => b.status !== 'deleted');
    // Existing requests retain their saved destination even if the local bank
    // was deleted or is missing. Only provider preflight may classify it; never
    // silently switch a queued payout to the user's new primary bank.
    const bank = prior?.funding_source_id
      ? allBanks.find(item=>item.source_id===prior.funding_source_id) || { source_id: prior.funding_source_id }
      : creditEligible.find((item) => item.source_id && item.is_primary) || creditEligible[0];
    if (!bank?.source_id) {
      return Response.json({ error: 'Link a bank account first', action: 'bank_link_required' }, { status: 400 });
    }

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) {
      return Response.json({ error: 'Withdraw up to $1,100.00 per request. Any remaining funds stay in your wallet.' }, { status: 400 });
    }
    try { withdrawalCents(value); } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    // The fee decision (including the full-balance waiver below) is finalized
    // once, either right below when the withdrawal is first created, or read
    // back from the persisted operation on a retry -- never recomputed against
    // a wallet balance that this withdrawal's own reservation has since
    // changed.
    let withdrawalFee = 0;
    if (!IDEMPOTENCY_KEY.test(String(idempotencyKey || ''))) {
      return Response.json({ error: 'A valid withdrawal idempotency key is required' }, { status: 400 });
    }

    lockOwner = crypto.randomUUID();
    if (!await acquireUserWalletLock(user.id, lockOwner)) {
      return Response.json({ error: 'withdrawal_in_progress', retryable: true }, { status: 409 });
    }
    // Recheck after acquiring the same lock used by identity callbacks.
    const lockedUser = await base44.asServiceRole.entities.User.get(user.id);
    if (!await hasVerifiedIdentity(base44, lockedUser) || (processingQueue && lockedUser.withdrawal_hold)) {
      return Response.json({ error: 'Identity verification (21+) is required and account restrictions must be resolved.' }, { status: 403 });
    }

    let operation = await claimWithdrawalOperation(user.id, idempotencyKey, value);
    if (!operation || Number(operation.amount) !== value) {
      return Response.json({ error: 'Invalid withdrawal idempotency key reuse' }, { status: 409 });
    }

    const auditTransactionId = operation.wallet_transaction_id || prior?.id;
    const releaseAudit = auditTransactionId ? await readOperationAudit(base44, {
      user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: auditTransactionId,
    }) : null;
    const hasReleaseIntent = releaseAudit?.release_ledger_group_id === `seamless:withdrawal:release:${auditTransactionId}` &&
      (DEFINITE_DESTINATION_REASONS.has(releaseAudit.last_error_code) || releaseAudit.last_error_code === 'bank_declined');
    const retryAuthorized = providerNoPaymentConfirmed && processingQueue && prior?.status === 'review_required' &&
      prior.integration_status === 'uncertain' && !operation.provider_reference_id && !releaseAudit?.provider_reference_id;
    // Durable provider/review evidence cannot be downgraded by a stale cache.
    if (['submitted','processing','completed','succeeded','uncertain','ambiguous','review_required','reversed'].includes(releaseAudit?.status) &&
        operation.state !== 'submitted' && !retryAuthorized) {
      return Response.json({ enabled: true, transaction_id: auditTransactionId, status: 'uncertain', deduplicated: true, reconciliation_required: true }, { status: 202 });
    }
    // Recover after Redis retention loss. A recorded definitive release intent
    // distinguishes an interrupted release from an ambiguous provider POST.
    if(!operation.wallet_transaction_id&&prior){
      const releaseRecovery = hasReleaseIntent && ['reserved','submitting','failed'].includes(prior.integration_status) &&
        ['pending','failed'].includes(prior.status) && !prior.provider_last_status;
      operation=await saveWithdrawalOperation(user.id,idempotencyKey,{...operation,wallet_transaction_id:prior.id,fee_amount:Number(prior.withdrawal_request_fee||0),state:releaseRecovery?'releasing':['submitted','settled'].includes(prior.integration_status)?'submitted':['submitting','uncertain'].includes(prior.integration_status)?'uncertain':prior.status==='failed'?'failed':'reserved'});
    }
    if (hasReleaseIntent) {
      failureStage = 'resume_definitive_release';
      diagnosticTransactionId = auditTransactionId;
      const releaseTx = await base44.asServiceRole.entities.WalletTransaction.get(auditTransactionId);
      await releaseWithdrawalReservation(base44, releaseTx, value, releaseAudit.last_error_code, releaseAudit.last_error_message, operation);
      return Response.json({ error: releaseAudit.last_error_message, transaction_id: releaseTx.id,
        request_terminal: true, withdrawal_reason: releaseAudit.last_error_code, deduplicated: true }, { status: 400 });
    }
    if (operation.state === 'submitted') {
      const sentTx=await base44.asServiceRole.entities.WalletTransaction.get(operation.wallet_transaction_id);
      if(sentTx.withdrawal_requested_at)await settleQueuedWithdrawalFee(base44,sentTx);
      return Response.json({ enabled: true, transaction_id: operation.wallet_transaction_id, provider_reference_id: operation.provider_reference_id || '', status: 'pending', deduplicated: true });
    }
    if (operation.state === 'submitting' || operation.state === 'uncertain') {
      if (providerNoPaymentConfirmed && processingQueue && prior &&
          prior.status === 'review_required' && prior.integration_status === 'uncertain' &&
          !operation.provider_reference_id) {
        operation = await saveWithdrawalOperation(user.id, idempotencyKey, {
          ...operation,
          state: 'reserved',
          reconciliation_required: false,
          provider_confirmed_no_payment_at: new Date().toISOString(),
        });
        await base44.asServiceRole.entities.WalletTransaction.update(prior.id, {
          status: 'pending',
          integration_status: 'reserved',
          withdrawal_request_status: 'queued',
          source_event: 'seamless_provider_retry_authorized',
          description: 'Seamless confirmed the prior submission never reached their infrastructure; one controlled retry is authorized.',
        });
      } else {
        return Response.json({ enabled: true, transaction_id: operation.wallet_transaction_id || '', status: 'uncertain', deduplicated: true, reconciliation_required: true }, { status: 202 });
      }
    }
    if (operation.state === 'failed' || operation.state === 'released') {
      return Response.json({ error: 'This withdrawal request could not be completed. Start a new request with a new idempotency key.' }, { status: 409 });
    }

    const profile = (await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id }))[0];
    if (!profile?.provider_user_id) {
      return Response.json({ error: 'No Seamless customer profile', action: 'ensure_customer' }, { status: 400 });
    }
    let complianceEvidence;
    try {
      complianceEvidence = await extendComplianceEvidenceRetention(base44, {
        userId: user.id,
        fundingSourceId: bank.source_id,
        requireAchAuthorization: false,
      });
    } catch {
      return Response.json({
        error: 'Required retained verified-bank evidence is unavailable.',
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
      const funding = await walletFundingSummary(base44, user.id);
      const availableBalance = funding.available_to_play;
      const baseFee = value < SMALL_WITHDRAWAL_THRESHOLD ? SMALL_WITHDRAWAL_FEE : 0;
      // A withdrawal of the user's entire available balance ("close out")
      // waives the small-withdrawal fee. Without this, a balance smaller than
      // the fee itself (e.g. $2 available, $2.50 fee) could never be
      // withdrawn at all under any requested amount -- funds permanently
      // stranded, exactly what minimums/fees are meant to avoid.
      const isFullBalanceWithdrawal = baseFee > 0 && availableBalance > 0 && value >= availableBalance - 0.005;
      withdrawalFee = isFullBalanceWithdrawal ? 0 : baseFee;
      const requiredBalance = value + withdrawalFee;
      if (!wallet || availableBalance < requiredBalance) {
        const errorMsg = withdrawalFee > 0
          ? `Insufficient balance. Withdrawal requires $${value.toFixed(2)} + $${withdrawalFee.toFixed(2)} fee = $${requiredBalance.toFixed(2)} available`
          : 'Insufficient available balance';
        return Response.json({ error: errorMsg }, { status: 400 });
      }
      tx = await base44.asServiceRole.entities.WalletTransaction.create({
        launch_epoch: 2,
        user_id: user.id, type: 'withdrawal', amount: value,
        description: 'Withdrawal requested.',
        withdrawal_requested_at:new Date().toISOString(),
        withdrawal_request_status:'preparing',
        withdrawal_request_fee:withdrawalFee,
        withdrawal_fee_state:withdrawalFee>0?'reserved':'none',
        withdrawal_request_email_status:'pending',
        status: 'pending', integration_status: 'pending', currency: 'USD', direction: 'reserve',
        source_event: 'seamless_withdrawal_request', initiating_actor: 'user', initiating_actor_id: user.id,
        idempotency_key: idempotencyKey, correlation_id: '', schema_version: 1,
        // The specific bank account (and, if one exists, its active debit
        // authorization) used for THIS withdrawal — captured now, not
        // re-derived later by looking up the user's current primary bank
        // account, which can point at a different account by the time
        // anyone investigates a dispute.
        funding_source_id: bank.source_id,
        ach_authorization_id: complianceEvidence?.authorization_id || '',
      });
      operation = await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: tx.id, state: 'new', fee_amount: withdrawalFee });
    } else {
      // Retry of an in-flight withdrawal: reuse the fee decision made on the
      // first attempt rather than recomputing it, since this withdrawal's own
      // reservation has already moved `value` out of available_balance by now.
      withdrawalFee = Number(operation.fee_amount || 0);
    }
    if(tx.withdrawal_requested_at && withdrawalFee>0 && !tx.withdrawal_fee_transaction_id){
      const key=idempotencyKey+':fee';
      const rows=await base44.asServiceRole.entities.WalletTransaction.filter({user_id:user.id,type:'withdrawal_fee',idempotency_key:key},'-created_date',2);
      if(rows.length>1)throw Error('duplicate_withdrawal_fee');
      const fee=rows[0]||await base44.asServiceRole.entities.WalletTransaction.create({launch_epoch:2,user_id:user.id,type:'withdrawal_fee',amount:withdrawalFee,status:'pending',integration_status:'reserved',direction:'debit',currency:'USD',description:'Withdrawal fee: $'+withdrawalFee.toFixed(2)+'.',idempotency_key:key,correlation_id:tx.id});
      tx=await base44.asServiceRole.entities.WalletTransaction.update(tx.id,{withdrawal_fee_transaction_id:fee.id});
    }
    const totalDebitAmount = value + withdrawalFee;

    const reservationGroupId = await reserveWithdrawal(base44, tx, value, withdrawalFee);
    operation = await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: tx.id, reservation_ledger_group_id: reservationGroupId, state: 'reserved' });
    await upsertOperationAudit(base44, {
      user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: tx.id, amount: value,
      status: 'reserved', reservation_ledger_group_id: reservationGroupId, attempts: 1,
    });

    if(tx.withdrawal_requested_at){
      if(!tx.withdrawal_estimated_arrival){
        const timing=await estimateQueuedWithdrawal(base44,tx);
        tx=await base44.asServiceRole.entities.WalletTransaction.update(tx.id,{...timing,withdrawal_request_status:'queued'});
      }
      await sendWithdrawalRequestedEmail(base44,tx).catch(()=>({failed:true}));
      if(!processingQueue || !await queuedWithdrawalReady(base44,tx)){
        await base44.asServiceRole.entities.WalletTransaction.update(tx.id,{withdrawal_request_status:'queued'});
        return Response.json({enabled:true,transaction_id:tx.id,status:'queued',estimated_arrival:tx.withdrawal_estimated_arrival,withdrawal_amount:value,withdrawal_fee:withdrawalFee,total_debit_amount:totalDebitAmount});
      }
    }
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
    await base44.asServiceRole.entities.WalletTransaction.update(tx.id, { integration_status: 'submitting', source_event: 'seamless_withdrawal_submitting', ...(tx.withdrawal_requested_at ? {withdrawal_request_status:'processing',withdrawal_provider_attempt_at:new Date().toISOString()}: {}) });
    await upsertOperationAudit(base44, { user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: tx.id, amount: value, status: 'submitting', reservation_ledger_group_id: reservationGroupId, attempts: 1 });

    diagnosticTransactionId = tx.id;
    // Preflight: read-only GET to confirm the saved destination. Separated
    // from the POST so definitive destination rejections release funds with
    // precise messaging, while indeterminate provider reads (ambiguous
    // response, timeout, 5xx) keep funds reserved and never describe as rejection.
    failureStage = 'withdrawal_preflight';
    let withdrawalBody;
    try {
      withdrawalBody = await buildVerifiedWithdrawalBody({
        providerUserId: profile.provider_user_id, name: accountHolderName.fullName, amount: value,
        description: `ChessBet withdrawal ${tx.id}`, label, sourceId: tx.funding_source_id, transferSpeed,
        // account is the merchant sender source_id ONLY when explicitly configured.
        // No configured value means account is omitted, matching the Direct Credit contract.
        senderSourceId: (Deno.env.get('SEAMLESS_MERCHANT_SENDER_ACCOUNT') || '').trim() || undefined,
        base44, userId: tx.user_id,
      });
    } catch (preflightError) {
      const reason = String(preflightError?.withdrawalReason || '');
      if (isDefinitePreflightRejection(preflightError)) {
        failureStage = 'release_preflight_rejection';
        const userMessage = WITHDRAWAL_PREFLIGHT_MESSAGES[reason] || 'This withdrawal could not be completed. Please try again or contact support.';
        console.error(JSON.stringify({event:'withdrawal_preflight_definitive',wallet_transaction_id:tx.id,reason}));
        await releaseWithdrawalReservation(base44, tx, value, reason, userMessage, operation);
        return Response.json({ error: userMessage, transaction_id: tx.id, request_terminal: true, withdrawal_reason: reason }, { status: 400 });
      }
      // Indeterminate preflight read: never release funds or describe as rejection.
      console.error(JSON.stringify({event:'withdrawal_preflight_indeterminate',wallet_transaction_id:tx.id,http_status:Number(preflightError?.status||0),reason:reason||'provider_read_indeterminate'}));
      await base44.asServiceRole.entities.WalletTransaction.update(tx.id, { integration_status: 'uncertain', source_event: 'seamless_withdrawal_preflight_uncertain', ...(tx.withdrawal_requested_at ? {withdrawal_request_status:'review_required'} : {}) });
      await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, state: 'uncertain', reconciliation_required: true });
      await upsertOperationAudit(base44, { user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: tx.id, amount: value, status: 'uncertain', reservation_ledger_group_id: reservationGroupId, attempts: 1, last_error_code: reason || 'withdrawal_preflight_indeterminate' });
      return Response.json({ enabled: true, transaction_id: tx.id, status: 'uncertain', reconciliation_required: true }, { status: 202 });
    }

    // POST: exactly-once submission. The submitting stage was persisted above;
    // a definite successful response captures the provider reference. An
    // ambiguous response never auto-POSTs again; reconcile by GET/provider history.
    failureStage = 'provider_submission';
    let data;
    try {
      const capacityKey = providerNoPaymentConfirmed
        ? `${tx.id}:provider-confirmed-retry:1`
        : tx.id;
      data = await sendLimitedWithdrawal(base44, tx.id, withdrawalBody, { capacityKey });
    } catch (error) {
      const status = Number(error?.status || 0);
      failureStage = 'provider_error_handling';
      console.error(JSON.stringify({event:'withdrawal_submission_error',wallet_transaction_id:tx.id,http_status:status,error_name:error?.name||'Error',reason:error.withdrawalReason||error.capacityReason||'provider_error'}));
      if(tx.withdrawal_requested_at && error.payoutCapacity && status===429){
        await saveWithdrawalOperation(user.id,idempotencyKey,{...operation,state:'reserved'});
        await base44.asServiceRole.entities.WalletTransaction.update(tx.id,{integration_status:'reserved',withdrawal_request_status:'queued',source_event:'seamless_withdrawal_queued'});
        await upsertOperationAudit(base44, {user_id:user.id,idempotency_key:idempotencyKey,wallet_transaction_id:tx.id,amount:value,status:'reserved',reservation_ledger_group_id:reservationGroupId,attempts:1,last_error_code:error.capacityReason || 'capacity_limit'});
        return Response.json({enabled:true,transaction_id:tx.id,status:'queued',reason:error.capacityReason || 'capacity_limit',estimated_arrival:tx.withdrawal_estimated_arrival});
      }
      if (status >= 400 && status < 500) {
        failureStage = 'release_rejected_reservation';
        await releaseWithdrawalReservation(base44, tx, value, 'bank_declined', 'The bank transfer could not be submitted. Your withdrawal was returned to your wallet and no withdrawal fee was charged.', operation);
        return Response.json({ error: error.payoutCapacity ? error.message : 'The bank transfer could not be submitted. Your withdrawal was returned to your wallet and no withdrawal fee was charged.', transaction_id: tx.id, request_terminal: true }, { status: error.payoutCapacity ? 429 : 400 });
      }
      await base44.asServiceRole.entities.WalletTransaction.update(tx.id, { integration_status: 'uncertain', source_event: 'seamless_withdrawal_uncertain' });
      await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, state: 'uncertain', reconciliation_required: true });
      await upsertOperationAudit(base44, { user_id: user.id, idempotency_key: idempotencyKey, wallet_transaction_id: tx.id, amount: value, status: 'uncertain', reservation_ledger_group_id: reservationGroupId, attempts: 1, last_error_code: 'provider_outcome_unknown' });
      return Response.json({ enabled: true, transaction_id: tx.id, status: 'uncertain', reconciliation_required: true }, { status: 202 });
    }

    failureStage = 'persist_provider_result';
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
    await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
      integration_status: 'submitted', direction: 'reserve', source_event: 'seamless_withdrawal_submitted',
      ...(tx.withdrawal_requested_at ? {withdrawal_request_status:'processing'} : {}),
      ...(withdrawalFee > 0 ? { description: `Seamless ACH withdrawal (a $${withdrawalFee.toFixed(2)} small-withdrawal fee was separately charged)` } : {}),
    });
    await saveWithdrawalOperation(user.id, idempotencyKey, { ...operation, state: 'submitted', provider_reference_id: providerRef });

    // Charge the small-withdrawal fee only now that Seamless has accepted the
    // payout request. Charging earlier would mean refunding it on every
    // synchronous rejection; charging here means the fee is only ever taken
    // once the withdrawal is essentially guaranteed to proceed. This posts as
    // its own WalletTransaction (type: withdrawal_fee) so it shows up as a
    // clearly separate, visible line in the user's transaction history --
    // and as a separate, immediately-completed ledger posting (not
    // held/reserved) so it never touches the withdrawal's own
    // reservation/settlement legs in the webhook -- those keep working
    // exactly as before, unmodified, and stay reconcilable against the exact
    // ACH amount Seamless received.
    let feeTransactionId = '';
    if (tx.withdrawal_requested_at && withdrawalFee > 0) {
      await settleQueuedWithdrawalFee(base44, await base44.asServiceRole.entities.WalletTransaction.get(tx.id));
      feeTransactionId=tx.withdrawal_fee_transaction_id;
    } else if (withdrawalFee > 0) {
      try {
        const feeGroupId = `seamless:withdrawal:fee:${tx.id}`;
        const feeIdempotencyKey = `${idempotencyKey}:fee`;
        let feeTx = (await base44.asServiceRole.entities.WalletTransaction.filter({ idempotency_key: feeIdempotencyKey }, '-created_date', 1))[0];
        if (!feeTx) {
          feeTx = await base44.asServiceRole.entities.WalletTransaction.create({
            launch_epoch: 2,
            user_id: user.id, type: 'withdrawal_fee', amount: withdrawalFee,
            description: `Small-withdrawal fee: applies to withdrawals under $${SMALL_WITHDRAWAL_THRESHOLD.toFixed(2)} (this one was $${value.toFixed(2)})`,
            status: 'pending', integration_status: 'internal_complete', currency: 'USD', direction: 'debit',
            source_event: 'seamless_withdrawal_fee', initiating_actor: 'system', initiating_actor_id: '',
            idempotency_key: feeIdempotencyKey, correlation_id: tx.id, schema_version: 1,
          });
        }
        feeTransactionId = feeTx.id;
        await postLedgerLegs(base44, {
          groupId: feeGroupId, walletTransactionId: feeTx.id, actor: 'system', triggerEvent: 'withdrawal_fee',
          externalRefType: 'provider_payout', externalRefId: providerRef,
          legs: [
            { ledgerAccount: 'user_account', userId: user.id, debit: withdrawalFee, credit: 0, transactionType: 'withdrawal_fee' },
            { ledgerAccount: 'platform_revenue', debit: 0, credit: withdrawalFee, transactionType: 'withdrawal_fee' },
          ],
        });
      } catch (feeError) {
        // Best-effort: never fail an already-accepted withdrawal over a fee
        // posting error. Logged for manual reconciliation.
        console.error(JSON.stringify({ event: 'withdrawal_fee_charge_failed', wallet_transaction_id: tx.id, error: feeError?.message || String(feeError) }));
      }
    }
    await upsertOperationAudit(base44, { user_id: user.id, idempotency_key: idempotencyKey, provider_reference_id: providerRef, wallet_transaction_id: tx.id, amount: value, status: 'submitted', reservation_ledger_group_id: reservationGroupId, attempts: 1, last_error_code: '' });
    await recordIntegrationEvent(base44, {
      eventType: 'financial.seamless_withdrawal_submitted', aggregateType: 'wallet_transaction', aggregateId: tx.id,
      correlationId: tx.id, idempotencyKey: `seamless:withdrawal:submitted:${tx.id}`, actorType: 'user', actorId: user.id,
      userId: user.id, walletTransactionId: tx.id, status: 'pending', amount: value, result: providerRef,
      eventData: { provider: SEAMLESS_PROVIDER_KEY, provider_ref: providerRef, label, transfer_speed: transferSpeed || 'standard' },
    });
    const response = { enabled: true, transaction_id: tx.id, provider_reference_id: providerRef, status: 'pending', transfer_speed: transferSpeed || 'standard' };
    if (withdrawalFee > 0) {
      response.withdrawal_amount = value;
      response.withdrawal_fee = withdrawalFee;
      response.total_debit_amount = totalDebitAmount;
      response.fee_transaction_id = feeTransactionId;
    }
    return Response.json(response);
  } catch (error) {
    console.error(JSON.stringify({event:'withdrawal_internal_failure',wallet_transaction_id:diagnosticTransactionId,stage:failureStage,error_name:error?.name||'Error',http_status:Number(error?.status||error?.response?.status||0),stack:String(error?.stack||'').split('\n').slice(1,4).join('\n')}));
    return Response.json({ error: 'Unable to submit withdrawal', reconciliation_required: failureStage !== 'validation' }, { status: 503 });
  } finally {
    if (userId && lockOwner) {
      try { await releaseUserWalletLock(userId, lockOwner); } catch { /* TTL safely releases an unavailable store lock. */ }
    }
  }
});