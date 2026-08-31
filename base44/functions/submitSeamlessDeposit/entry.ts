import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import {
  seamlessConfig, seamlessRequest, seamlessBaseUrl, buildDepositBody,
  PATH_ACH_DEBIT, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

const MAX_AMOUNT = 10000;

// Submits a Seamless ACH debit (deposit) to the user's verified funding source.
// Provider acceptance creates ONLY a pending WalletTransaction — displayed
// wallet balances are NEVER credited merely because the API accepted the
// request. The ledger is posted exactly once when a Processed webhook later
// confirms settlement (seamlessAchWebhook). Fails closed on Early Access or
// missing configuration.
Deno.serve(async (req) => {
  try {
    if (EARLY_ACCESS_MODE) {
      return Response.json({
        enabled: false,
        reason: 'Deposits are unavailable during Early Access.',
      });
    }
    seamlessConfig(); // fail closed

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { amount } = await req.json();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) {
      return Response.json({ error: 'Invalid deposit amount' }, { status: 400 });
    }
    if (!isSocureIdentityVerified(user) || user.withdrawal_hold) {
      return Response.json({ error: 'Your account is not eligible for bank transfers' }, { status: 403 });
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
    // platform. Mirrors the existing Plaid deposit gate so behavior is
    // unchanged for users.
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
    const pending = await base44.asServiceRole.entities.WalletTransaction.create({
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
      idempotency_key: `seamless:deposit:${user.id}:${crypto.randomUUID()}`,
      correlation_id: '',
      schema_version: 1,
    });

    const label = `chessbet-deposit-${pending.id}`;
    const body = buildDepositBody({
      providerUserId: profile.provider_user_id,
      name: user.full_name || user.email,
      amount: value,
      description: 'Fund wallet',
      label,
    });

    let providerRef = '';
    try {
      const data = await seamlessRequest('POST', PATH_ACH_DEBIT, body);
      providerRef = data?.check_id || data?.check?.id || data?.id || data?.check?.check_id || '';
      if (!providerRef) throw new Error('Seamless did not return a transaction id');
    } catch (error) {
      // Provider rejected the request — keep the transaction as a failed
      // pending record (NO ledger posting) so it never credits the wallet.
      await base44.asServiceRole.entities.WalletTransaction.update(pending.id, {
        integration_status: 'failed',
        description: `Seamless ACH funding rejected: ${error?.message || 'unknown'}`,
      });
      await recordIntegrationEvent(base44, {
        eventType: 'financial.seamless_deposit_rejected',
        aggregateType: 'wallet_transaction',
        aggregateId: pending.id,
        correlationId: pending.id,
        idempotencyKey: pending.idempotency_key,
        actorType: 'user',
        actorId: user.id,
        userId: user.id,
        walletTransactionId: pending.id,
        status: 'failed',
        amount: value,
        result: 'rejected',
        eventData: { provider: SEAMLESS_PROVIDER_KEY, error: error?.message || 'unknown' },
      });
      return Response.json(
        { error: error?.message || 'Deposit submission failed', transaction_id: pending.id },
        { status: 400 }
      );
    }

    // Submission accepted: mark the durable record as submitted to the provider.
    // Still NO ledger posting / balance change until Processed webhook.
    await base44.asServiceRole.entities.WalletTransaction.update(pending.id, {
      integration_status: 'submitted',
      idempotency_key: `seamless:deposit:${pending.id}`,
    });

    await base44.asServiceRole.entities.IntegrationReference.create({
      provider_key: SEAMLESS_PROVIDER_KEY,
      reference_type: 'payment',
      external_reference_id: providerRef,
      internal_entity_type: 'wallet_transaction',
      internal_entity_id: pending.id,
      correlation_id: pending.id,
      idempotency_key: `seamless:deposit:${pending.id}`,
      user_id: user.id,
      wallet_transaction_id: pending.id,
      status: 'submitted',
      effective_at: new Date().toISOString(),
      metadata_json: JSON.stringify({
        provider: SEAMLESS_PROVIDER_KEY, direction: 'deposit', amount: value, label,
        endpoint: `${seamlessBaseUrl((Deno.env.get('SEAMLESS_ACH_ENV') || '').trim())}${PATH_ACH_DEBIT}`,
      }),
    });

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