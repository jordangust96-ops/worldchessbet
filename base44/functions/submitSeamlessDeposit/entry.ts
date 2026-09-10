import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { seamlessDepositsEnabled } from '../../shared/seamlessFundingConfig.ts';
import { extendComplianceEvidenceRetention } from '../../shared/complianceEvidence.ts';
import { getRequestJurisdiction } from '../../shared/requestJurisdiction.ts';
import { meetsStateAge } from '../../shared/playerAgePolicy.js';
import { hasVerifiedIdentity } from '../../shared/identityEligibility.js';
import { legalNameFromUser } from '../../shared/legalName.ts';
import {
  seamlessConfig, seamlessRequest, seamlessBaseUrl, buildDepositBody,
  PATH_ACH_DEBIT, SEAMLESS_PROVIDER_KEY, userSafeTransferFailureReason,
} from '../../shared/seamlessAch.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import {
  acquireUserWalletLock, releaseUserWalletLock, claimDepositOperation, saveDepositOperation,
} from '../../shared/seamlessAtomicStore.ts';

const MIN_DEPOSIT_AMOUNT = 10; // Minimum $10 to cover $5 contest + $1 platform fee
const MAX_AMOUNT = 10000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

// Submits a Seamless ACH debit (deposit) to the user's verified funding source.
// Provider acceptance creates ONLY a pending WalletTransaction — displayed
// wallet balances are NEVER credited merely because the API accepted the
// request. The ledger is posted exactly once when a Processed webhook later
// confirms settlement (seamlessAchWebhook). Fails closed when deposits are
// disabled or provider configuration is missing.
// Mirrors submitSeamlessWithdrawal's per-user Redis lock: without it, a user
// (or a buggy/compromised client) could fire multiple concurrent deposit
// requests with distinct idempotency keys against the same bank account with
// no velocity control, each independently reaching Seamless.
Deno.serve(async (req) => {
  let lockOwner = '';
  let userId = '';
  try {
    if (req.method !== 'POST') return Response.json({error:'Method not allowed'},{status:405});
    if (!seamlessDepositsEnabled()) {
      return Response.json({
        enabled: false,
        reason: 'Account funding is temporarily unavailable.',
      }, { status: 409 });
    }
    seamlessConfig(); // fail closed

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    userId = user.id;

    const { amount, idempotencyKey, bankSourceId } = await req.json().catch(() => ({}));
    const value = Number(amount);
    if (!Number.isFinite(value) || value < MIN_DEPOSIT_AMOUNT || value > MAX_AMOUNT || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
      return Response.json({ error: `Deposit amount must be between $${MIN_DEPOSIT_AMOUNT} and $${MAX_AMOUNT}` }, { status: 400 });
    }
    if (!IDEMPOTENCY_KEY.test(String(idempotencyKey || ''))) {
      return Response.json({ error: 'A valid deposit idempotency key is required' }, { status: 400 });
    }
    if (!await hasVerifiedIdentity(base44, user) || user.withdrawal_hold) {
      return Response.json({ error: 'Identity verification (21+) is required and account holds must be resolved before transfers. Contact hello@worldchessbet.com for help accessing existing funds.' }, { status: 403 });
    }

    const verifiedBanks = await base44.asServiceRole.entities.SeamlessBankAccount.filter({ user_id: user.id, status: 'verified' });
    if (!verifiedBanks.some((item) => item.source_id)) {
      return Response.json({ error: 'Link and verify a bank account first.', action: 'bank_link_required' }, { status: 400 });
    }
    // Seamless /ach-debit charges the customer's provider-primary bank and does
    // not accept a funding-source id in the request. Require that exact primary
    // source to be webhook-verified locally; falling back to a different bank
    // would mislabel the audit trail and could charge an account the player did
    // not see in the confirmation UI.
    let bank = verifiedBanks.find((item) => item.source_id && item.is_primary);
    if (!bank?.source_id) {
      return Response.json({
        error: 'Your selected bank is still awaiting verification. Choose a connected bank before depositing.',
        action: 'verified_primary_required',
      }, { status: 409 });
    }
    lockOwner = crypto.randomUUID();
    if (!await acquireUserWalletLock(user.id, lockOwner)) {
      return Response.json({ error: 'deposit_in_progress', retryable: true }, { status: 409 });
    }
    // Recheck after acquiring the same lock used by identity callbacks.
    const lockedUser = await base44.asServiceRole.entities.User.get(user.id);
    if (!await hasVerifiedIdentity(base44, lockedUser) || lockedUser.withdrawal_hold) {
      return Response.json({ error: 'Identity verification (21+) is required and account restrictions must be resolved.' }, { status: 403 });
    }

    // Bank management uses this same lock. Re-read the primary after waiting
    // and bind it to the source displayed in the updated client.
    const lockedBanks = await base44.asServiceRole.entities.SeamlessBankAccount.filter({user_id:user.id,status:'verified'});
    bank = lockedBanks.find(item => item.source_id && item.is_primary);
    if (!bank || (bankSourceId && bankSourceId !== bank.source_id))
      return Response.json({error:'Your selected bank changed. Review your bank account before depositing.',action:'refresh_bank'},{status:409});

    let operation = await claimDepositOperation(user.id, idempotencyKey, value);
    if (!operation || Number(operation.amount) !== value) {
      return Response.json({ error: 'Invalid deposit idempotency key reuse' }, { status: 409 });
    }
    if (operation.state === 'submitted') {
      return Response.json({ enabled: true, transaction_id: operation.wallet_transaction_id, provider_reference_id: operation.provider_reference_id || '', status: 'pending', deduplicated: true });
    }
    if (operation.state === 'submitting' || operation.state === 'uncertain') {
      return Response.json({ enabled: true, transaction_id: operation.wallet_transaction_id || '', status: 'uncertain', deduplicated: true, reconciliation_required: true }, { status: 202 });
    }
    if (operation.state === 'failed') {
      return Response.json({ error: 'This deposit request was rejected. You can start a new deposit.', request_terminal:true }, { status: 409 });
    }

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0];
    if (!profile || !profile.provider_user_id) {
      return Response.json({ error: 'No Seamless customer profile', action: 'ensure_customer' }, { status: 400 });
    }

    let complianceEvidence;
    try {
      complianceEvidence = await extendComplianceEvidenceRetention(base44, {
        userId: user.id,
        fundingSourceId: bank.source_id,
        requireAchAuthorization: true,
      });
    } catch {
      return Response.json({
        error: 'Required verified-bank or ACH authorization evidence is unavailable.',
        action: 'compliance_evidence_required',
      }, { status: 409 });
    }

    // Jurisdiction determines whether new funds may be brought onto the paid
    // platform. This preserves the existing deposit-location gate.
    const jurisdiction = {data:await (await getRequestJurisdiction(req, {
      triggerEvent: 'deposit',
      relatedEntityType: 'deposit',
      contextAmount: value,
    })).json()};
    if (jurisdiction.data?.error || jurisdiction.data?.status !== 'approved') {
      return Response.json(
        { error: jurisdiction.data?.reason || 'You are not currently eligible to fund your account from this location.' },
        { status: 403 }
      );
    }
    if (!(lockedUser.role === 'admin' && jurisdiction.data?.adminBypass === true) && !meetsStateAge(await base44.asServiceRole.entities.User.get(user.id), jurisdiction.data?.state)) {
      return Response.json({ eligible: false, error: 'Identity verification and age 21+ are required in an approved state.', reason: 'Identity verification and age 21+ are required in an approved state.' }, { status: 403 });
    }

    // Durable idempotency: create the pending WalletTransaction FIRST with a
    // stable idempotency_key, and never resubmit an already-provider-submitted
    // transaction. The label ties the provider request back to this record.
    let pending = operation.wallet_transaction_id
      ? await base44.asServiceRole.entities.WalletTransaction.get(operation.wallet_transaction_id)
      : null;
    if (!pending) {
      pending = await base44.asServiceRole.entities.WalletTransaction.create({
        launch_epoch: 2,
        user_id: user.id,
        type: 'deposit',
        amount: value,
        description: 'Seamless ACH funding pending',
        status: 'pending',
        integration_status: 'pending',
        currency: 'USD',
        direction: 'credit',
        source_event: 'seamless_deposit',
        initiating_actor: 'user',
        initiating_actor_id: user.id,
        idempotency_key: idempotencyKey,
        correlation_id: '',
        schema_version: 1,
        // The specific bank account and its active debit authorization used
        // for THIS deposit — captured now, not re-derived later by looking
        // up the user's current primary bank account (which requireAchAuthorization
        // above already confirms was authorized at request time, but
        // is_primary/the authorization itself can both change afterward).
        funding_source_id: bank.source_id,
        ach_authorization_id: complianceEvidence?.authorization_id || '',
      });
      operation = await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, state: 'new' });
    }

    const accountHolderName = legalNameFromUser(lockedUser);
    if (!accountHolderName) {
      await base44.asServiceRole.entities.WalletTransaction.update(pending.id, {
        status: 'failed', integration_status: 'failed', description: 'Seamless ACH funding requires an account holder name.',
      });
      await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, state: 'failed', last_error_code: 'account_holder_name_required' });
      return Response.json({ error: 'A verified account holder name is required before funding.' }, { status: 400 });
    }

    const label = `chessbet-deposit-${pending.id}`;
    // Save a label reference before the provider call. It lets a callback for
    // an in-doubt request be reconciled without treating the browser retry as
    // permission to submit a second ACH debit.
    const existingLabelRef = (await base44.asServiceRole.entities.IntegrationReference.filter({ external_reference_id: label }, '-created_date', 1))[0];
    if (!existingLabelRef) {
      await base44.asServiceRole.entities.IntegrationReference.create({
        provider_key: SEAMLESS_PROVIDER_KEY, reference_type: 'payment', external_reference_id: label,
        internal_entity_type: 'wallet_transaction', internal_entity_id: pending.id, correlation_id: pending.id,
        idempotency_key: idempotencyKey, user_id: user.id, wallet_transaction_id: pending.id,
        status: 'submitting', effective_at: new Date().toISOString(),
        metadata_json: JSON.stringify({ provider: SEAMLESS_PROVIDER_KEY, direction: 'deposit', label }),
      });
    }
    operation = await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, label, state: 'submitting' });
    await base44.asServiceRole.entities.WalletTransaction.update(pending.id, { integration_status: 'submitting', source_event: 'seamless_deposit_submitting' });

    const body = buildDepositBody({
      providerUserId: profile.provider_user_id, name: accountHolderName.fullName, amount: value,
      description: 'Fund wallet', label,
    });

    let data;
    try {
      data = await seamlessRequest('POST', PATH_ACH_DEBIT, body);
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status >= 400 && status < 500) {
        const failureReason = userSafeTransferFailureReason(error?.message, 'deposit');
        await base44.asServiceRole.entities.WalletTransaction.update(pending.id, {
          status: 'failed', integration_status: 'failed', description: `Deposit failed — ${failureReason}`,
        });
        await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, label, state: 'failed', last_error_code: 'provider_rejected' });
        await recordIntegrationEvent(base44, {
          eventType: 'financial.seamless_deposit_rejected', aggregateType: 'wallet_transaction', aggregateId: pending.id,
          correlationId: pending.id, idempotencyKey, actorType: 'user', actorId: user.id, userId: user.id,
          walletTransactionId: pending.id, status: 'failed', amount: value, result: 'rejected',
          eventData: { provider: SEAMLESS_PROVIDER_KEY, error: failureReason },
        });
        return Response.json({ error: failureReason, transaction_id: pending.id, request_terminal:true }, { status: 400 });
      }
      await base44.asServiceRole.entities.WalletTransaction.update(pending.id, { integration_status: 'uncertain', source_event: 'seamless_deposit_uncertain' });
      await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, label, state: 'uncertain', reconciliation_required: true, last_error_code: 'provider_outcome_unknown' });
      return Response.json({ enabled: true, transaction_id: pending.id, status: 'uncertain', reconciliation_required: true }, { status: 202 });
    }

    const providerRef = data?.check_id || data?.check?.id || data?.id || data?.check?.check_id || '';
    if (!providerRef) {
      await base44.asServiceRole.entities.WalletTransaction.update(pending.id, { integration_status: 'uncertain', source_event: 'seamless_deposit_uncertain' });
      await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, label, state: 'uncertain', reconciliation_required: true, last_error_code: 'missing_provider_reference' });
      return Response.json({ enabled: true, transaction_id: pending.id, status: 'uncertain', reconciliation_required: true }, { status: 202 });
    }

    // Submission accepted: mark the durable record as submitted to the provider.
    // Still NO ledger posting / balance change until Processed webhook.
    await base44.asServiceRole.entities.WalletTransaction.update(pending.id, {
      integration_status: 'submitted', idempotency_key: idempotencyKey,
      source_event: 'seamless_deposit_submitted',
    });

    await base44.asServiceRole.entities.IntegrationReference.create({
      provider_key: SEAMLESS_PROVIDER_KEY,
      reference_type: 'payment',
      external_reference_id: providerRef,
      internal_entity_type: 'wallet_transaction',
      internal_entity_id: pending.id,
      correlation_id: pending.id,
      idempotency_key: idempotencyKey,
      user_id: user.id,
      wallet_transaction_id: pending.id,
      status: 'submitted',
      effective_at: new Date().toISOString(),
      metadata_json: JSON.stringify({
        provider: SEAMLESS_PROVIDER_KEY, direction: 'deposit', amount: value, label,
        endpoint: `${seamlessBaseUrl((Deno.env.get('SEAMLESS_ACH_ENV') || '').trim())}${PATH_ACH_DEBIT}`,
      }),
    });

    await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, label, state: 'submitted', provider_reference_id: providerRef });

    await recordIntegrationEvent(base44, {
      eventType: 'financial.seamless_deposit_submitted',
      aggregateType: 'wallet_transaction',
      aggregateId: pending.id,
      correlationId: pending.id,
      idempotencyKey: `seamless:deposit:${pending.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      walletTransactionId: pending.id,
      status: 'pending',
      amount: value,
      result: providerRef,
      eventData: { provider: SEAMLESS_PROVIDER_KEY, provider_ref: providerRef, label },
    });

    return Response.json({
      enabled: true,
      transaction_id: pending.id,
      provider_reference_id: providerRef,
      status: 'pending',
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to submit deposit' }, { status: 500 });
  } finally {
    if (userId && lockOwner) {
      try { await releaseUserWalletLock(userId, lockOwner); } catch { /* TTL safely releases an unavailable store lock. */ }
    }
  }
});