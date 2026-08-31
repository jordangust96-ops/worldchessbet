import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';
import { plaid } from '../../shared/plaid.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';

Deno.serve(async (req) => {
  try {
    if (EARLY_ACCESS_MODE) {
      return Response.json({ enabled: false, reason: 'Bank transfers are unavailable during Early Access.' });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { amount, direction } = await req.json();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 10000 || !['deposit', 'withdrawal'].includes(direction)) {
      return Response.json({ error: 'Invalid transfer request' }, { status: 400 });
    }
    if (!isSocureIdentityVerified(user) || user.withdrawal_hold) {
      return Response.json({ error: 'Your account is not eligible for bank transfers' }, { status: 403 });
    }

    const bank = (
      await base44.asServiceRole.entities.PlaidBankAccount.filter({ user_id: user.id, status: 'linked' })
    )[0];
    if (!bank) return Response.json({ error: 'Link a bank account first' }, { status: 400 });

    const wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id }))[0];
    if (direction === 'withdrawal' && (!wallet || wallet.available_balance < value)) {
      return Response.json({ error: 'Insufficient available balance' }, { status: 400 });
    }

    // Location determines whether a user may bring new funds onto the paid
    // contest platform. It never prevents a user from withdrawing funds that
    // are already theirs.
    if (direction === 'deposit') {
      const jurisdiction = await base44.functions.invoke('getCurrentJurisdiction', {
        triggerEvent: 'deposit',
        relatedEntityType: 'deposit',
        contextAmount: value,
      });
      if (jurisdiction.data?.error || jurisdiction.data?.status !== 'approved') {
        return Response.json({
          error: jurisdiction.data?.reason || 'You are not currently eligible to fund your account from this location.',
        }, { status: 403 });
      }
    }

    const legal_name = user.full_name || user.name || user.email;
    const key = `plaid:${direction}:${user.id}:${crypto.randomUUID()}`;
    const auth = await plaid('/transfer/authorization/create', {
      access_token: bank.plaid_access_token,
      account_id: bank.account_id,
      type: direction === 'deposit' ? 'debit' : 'credit',
      network: 'ach',
      ach_class: direction === 'deposit' ? 'web' : 'ppd',
      amount: value.toFixed(2),
      user: { legal_name },
      idempotency_key: key,
    });
    if (auth.authorization?.decision !== 'approved') {
      return Response.json({
        error: 'Transfer was not approved. Please use another account.',
        decision: auth.authorization?.decision,
      }, { status: 400 });
    }

    const transfer = await plaid('/transfer/create', {
      access_token: bank.plaid_access_token,
      account_id: bank.account_id,
      authorization_id: auth.authorization.id,
      amount: value.toFixed(2),
      description: direction === 'deposit' ? 'Fund wallet' : 'Withdrawal',
    });
    const tx = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: direction,
      amount: value,
      description: direction === 'deposit' ? 'Plaid ACH funding pending' : 'Plaid ACH withdrawal pending',
      status: 'pending',
      integration_status: 'submitted',
      provider: 'plaid_transfer',
      provider_transfer_id: transfer.transfer.id,
      idempotency_key: key,
    });
    await recordIntegrationEvent(base44, {
      eventType: `financial.plaid_${direction}_submitted`,
      aggregateType: 'wallet_transaction',
      aggregateId: tx.id,
      correlationId: tx.id,
      idempotencyKey: key,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      walletTransactionId: tx.id,
      status: 'pending',
      amount: value,
      result: transfer.transfer.id,
      eventData: { provider: 'plaid', transfer_id: transfer.transfer.id },
    });
    return Response.json({ success: true, transaction: tx });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to submit bank transfer' }, { status: 500 });
  }
});