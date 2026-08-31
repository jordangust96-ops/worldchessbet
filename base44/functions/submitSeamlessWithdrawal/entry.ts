import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';
import {
  seamlessConfig, seamlessRequest, seamlessBaseUrl, buildWithdrawalBody,
  PATH_CHECK_SEND, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

const MAX_AMOUNT = 10000;

// Submits a Seamless ACH withdrawal (check/send) to the user's PRIMARY verified
// funding source. Re-fetches the authoritative wallet and verifies
// available_balance >= amount immediately before submitting to prevent
// over-withdrawal. Provider acceptance creates ONLY a pending
// WalletTransaction — displayed balances are NEVER debited merely because the
// API accepted the request. Final settlement/debit is posted exactly once on a
// Processed webhook (seamlessAchWebhook); failures are reversed there too.
//
// NOTE (launch-blocker, see report): held-balance reservation so concurrent
// withdrawals cannot overspend is intentionally NOT posted here, because the
// existing authoritative postLedgerLegs helper marks a WalletTransaction
// 'completed' when it posts. A correct reservation requires a dedicated
// hold-ledger pattern to be validated against the ledger invariant before it
// is safe. Until Early Access is turned off, no real withdrawal can be
// submitted, so this is dormant. The authoritative available-balance guard
// below is the current overspend fence.
Deno.serve(async (req) => {
  try {
    if (EARLY_ACCESS_MODE) {
      return Response.json({
        enabled: false,
        reason: 'Withdrawals are unavailable during Early Access.',
      });
    }
    seamlessConfig(); // fail closed

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { amount } = await req.json();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) {
      return Response.json({ error: 'Invalid withdrawal amount' }, { status: 400 });
    }
    // Withdrawals never require a jurisdiction check — a user may always
    // retrieve funds that are already theirs.
    if (user.account_state !== 'verified' || user.withdrawal_hold) {
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

    // Authoritative available-balance guard immediately before submission.
    const wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id }))[0];
    if (!wallet || (wallet.available_balance || 0) < value) {
      return Response.json({ error: 'Insufficient available balance' }, { status: 400 });
    }

    const pending = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'withdrawal',
      amount: value,
      description: 'Seamless ACH withdrawal pending',
      status: 'pending',
      integration_status: 'pending',
      currency: 'USD',
      direction: 'debit',
      source_event: 'seamless_withdrawal',
      initiating_actor: 'user',
      initiating_actor_id: user.id,
      idempotency_key: `seamless:withdrawal:${user.id}:${crypto.randomUUID()}`,
      correlation_id: '',
      schema_version: 1,
    });

    const label = `chessbet-withdrawal-${pending.id}`;
    const body = buildWithdrawalBody({
      providerUserId: profile.provider_user_id,
      name: user.full_name || user.email,
      amount: value,
      description: 'Withdrawal',
      label,
      sourceId: bank.source_id,
    });

    let providerRef = '';
    try {
      const data = await seamlessRequest('POST', PATH_CHECK_SEND, body);
      providerRef = data?.check_id || data?.check?.id || data?.id || data?.check?.check_id || '';
      if (!providerRef) throw new Error('Seamless did not return a transaction id');
    } catch (error) {
      await base44.asServiceRole.entities.WalletTransaction.update(pending.id, {
        integration_status: 'failed',
        description: `Seamless ACH withdrawal rejected: ${error?.message || 'unknown'}`,
      });
      await recordIntegrationEvent(base44, {
        eventType: 'financial.seamless_withdrawal_rejected',
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
        { error: error?.message || 'Withdrawal submission failed', transaction_id: pending.id },
        { status: 400 }
      );
    }

    await base44.asServiceRole.entities.WalletTransaction.update(pending.id, {
      integration_status: 'submitted',
      idempotency_key: `seamless:withdrawal:${pending.id}`,
    });

    await base44.asServiceRole.entities.IntegrationReference.create({
      provider_key: SEAMLESS_PROVIDER_KEY,
      reference_type: 'payout',
      external_reference_id: providerRef,
      internal_entity_type: 'wallet_transaction',
      internal_entity_id: pending.id,
      correlation_id: pending.id,
      idempotency_key: `seamless:withdrawal:${pending.id}`,
      user_id: user.id,
      wallet_transaction_id: pending.id,
      status: 'submitted',
      effective_at: new Date().toISOString(),
      metadata_json: JSON.stringify({
        provider: SEAMLESS_PROVIDER_KEY, direction: 'withdrawal', amount: value, label,
        source_id: bank.source_id,
        endpoint: `${seamlessBaseUrl((Deno.env.get('SEAMLESS_ACH_ENV') || '').trim())}${PATH_CHECK_SEND}`,
      }),
    });

    await recordIntegrationEvent(base44, {
      eventType: 'financial.seamless_withdrawal_submitted',
      aggregateType: 'wallet_transaction',
      aggregateId: pending.id,
      correlationId: pending.id,
      idempotencyKey: `seamless:withdrawal:${pending.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      walletTransactionId: pending.id,
      status: 'pending',
      amount: value,
      result: providerRef,
      eventData: { provider: SEAMLESS_PROVIDER_KEY, provider_ref: providerRef, label, source_id: bank.source_id },
    });

    return Response.json({
      enabled: true,
      transaction_id: pending.id,
      provider_reference_id: providerRef,
      status: 'pending',
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to submit withdrawal' }, { status: 500 });
  }
});