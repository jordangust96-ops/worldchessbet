import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { seamlessDepositsEnabled } from '../../shared/seamlessFundingConfig.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import { legalNameFromUser } from '../../shared/legalName.ts';
import { isSocureBankVerificationAccepted, latestSocureBankVerification } from '../../shared/socureBankEligibility.js';
import {
  seamlessConfig, seamlessRequest, seamlessBaseUrl, buildDepositBody,
  PATH_ACH_DEBIT, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { claimDepositOperation, saveDepositOperation } from '../../shared/seamlessAtomicStore.ts';

const MAX_AMOUNT = 10000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

// Submits a Seamless ACH debit (deposit) to the user's verified funding source.
// Provider acceptance creates ONLY a pending WalletTransaction — displayed
// wallet balances are NEVER credited merely because the API accepted the
// request. The ledger is posted exactly once when a Processed webhook later
// confirms settlement (seamlessAchWebhook). Fails closed when deposits are
// disabled or provider configuration is missing.
Deno.serve(async (req) => {
  try {
    if (!seamlessDepositsEnabled()) {
      return Response.json({
        enabled: false,
        reason: 'Account funding is not available yet.',
      }, { status: 409 });
    }
    seamlessConfig(); // fail closed

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { amount, idempotencyKey } = await req.json();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) {
      return Response.json({ error: 'Invalid deposit amount' }, { status: 400 });
    }
    if (!IDEMPOTENCY_KEY.test(String(idempotencyKey || ''))) {
      return Response.json({ error: 'A valid deposit idempotency key is required' }, { status: 400 });
    }
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
      return Response.json({ error: 'Complete bank account screening before funding.', action: 'bank_screening_required' }, { status: 403 });
    }

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
      return Response.json({ error: 'This deposit request was rejected. Start a new request with a new idempotency key.' }, { status: 409 });
    }

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0];
    if (!profile || !profile.provider_user_id) {
      return Response.json({ error: 'No Seamless customer profile', action: 'ensure_customer' }, { status: 400 });
    }

    const bank = (
      await base44.asServiceRole.entities.SeamlessBankAccount.filter({
        user_id: user.id, status: 'verified',
      })
    ).find((b) => !!(b.source_id && b.is_primary)) ||
      (await base44.asServiceRole.entities.SeamlessBankAccount.filter({ user_id: user.id, status: 'verified' }))[0];
    if (!bank) {
      return Response.json({ error: 'Link and verify a bank account first', action: 'bank_link_required' }, { status: 400 });
    }

    // Jurisdiction determines whether new funds may be brought onto the paid
    // platform. This preserves the existing deposit-location gate.
    const jurisdiction = await base44.functions.invoke('getCurrentJurisdiction', {
      triggerEvent: 'deposit',
      relatedEntityType: 'deposit',
      contextAmount: value,
    });
    if (jurisdiction.data?.error || jurisdiction.data?.status !== 'approved') {
      return Response.json(
        { error: jurisdiction.data?.reason || 'You are not currently eligible to fund your account from this location.' },
        { status: 403 }
      );
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
      });
      operation = await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, state: 'new' });
    }

    const accountHolderName = legalNameFromUser(user);
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
        await base44.asServiceRole.entities.WalletTransaction.update(pending.id, {
          status: 'failed', integration_status: 'failed', description: `Seamless ACH funding rejected: ${error?.message || 'unknown'}`,
        });
        await saveDepositOperation(user.id, idempotencyKey, { ...operation, wallet_transaction_id: pending.id, label, state: 'failed', last_error_code: 'provider_rejected' });
        await recordIntegrationEvent(base44, {
          eventType: 'financial.seamless_deposit_rejected', aggregateType: 'wallet_transaction', aggregateId: pending.id,
          correlationId: pending.id, idempotencyKey, actorType: 'user', actorId: user.id, userId: user.id,
          walletTransactionId: pending.id, status: 'failed', amount: value, result: 'rejected',
          eventData: { provider: SEAMLESS_PROVIDER_KEY, error: error?.message || 'unknown' },
        });
        return Response.json({ error: 'Deposit submission failed', transaction_id: pending.id }, { status: 400 });
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
  }
});