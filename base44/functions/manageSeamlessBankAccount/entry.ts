import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  seamlessRequest,
  SEAMLESS_PLAID_PROVIDER_KEY,
  PATH_REMOVE_FUNDING_SOURCE,
  PATH_SET_PRIMARY_FUNDING_SOURCE,
} from '../../shared/seamlessAch.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

const ACTIVE_TRANSACTION_STATUSES = new Set(['pending', 'processing']);
const ACTIVE_INTEGRATION_STATUSES = new Set([
  'pending', 'reserved', 'submitting', 'submitted', 'uncertain',
]);

async function activeAuthorizationFor(base44, userId: string, sourceId: string) {
  return (
    await base44.asServiceRole.entities['ach-debit-authorization'].filter(
      { user_id: userId, funding_source_id: sourceId, status: 'active' },
      '-accepted_at',
      2,
    )
  )[0] || null;
}

async function setProviderPrimary(base44, user, profile, bank) {
  const authorization = await activeAuthorizationFor(base44, user.id, bank.source_id);
  if (!authorization || authorization.provider_key !== SEAMLESS_PLAID_PROVIDER_KEY) {
    throw Object.assign(new Error('bank_authorization_required'), { publicStatus: 409 });
  }

  await seamlessRequest('POST', PATH_SET_PRIMARY_FUNDING_SOURCE, {
    user_id: profile.provider_user_id,
    source_id: bank.source_id,
  });

  const banks = await base44.asServiceRole.entities.SeamlessBankAccount.filter(
    { user_id: user.id },
    '-created_date',
    50,
  );
  for (const candidate of banks) {
    const shouldBePrimary = candidate.id === bank.id;
    if (!!candidate.is_primary !== shouldBePrimary) {
      await base44.asServiceRole.entities.SeamlessBankAccount.update(candidate.id, {
        is_primary: shouldBePrimary,
      });
    }
  }

  // Bank selection does not change player KYC or account restrictions.
}

async function audit(base44, userId: string, bank, action: string, result: string) {
  const eventId = crypto.randomUUID();
  await recordIntegrationEvent(base44, {
    eventType: `financial.seamless_bank_${action}`,
    aggregateType: 'user',
    aggregateId: userId,
    correlationId: bank.source_id,
    idempotencyKey: `seamless:bank-management:${action}:${eventId}`,
    actorType: 'user',
    actorId: userId,
    userId,
    status: 'completed',
    result,
    eventData: {
      provider: 'seamless_ach',
      bank_id: bank.id,
      source_id: bank.source_id,
    },
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (['suspended', 'closed'].includes(user.account_state || '')) {
      return Response.json({ error: 'Bank account changes are unavailable for this account.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim();
    const bankId = String(body?.bankId || '').trim();
    if (!['set_primary', 'disconnect'].includes(action) || !bankId) {
      return Response.json({ error: 'Invalid bank account action.' }, { status: 400 });
    }

    const bank = await base44.asServiceRole.entities.SeamlessBankAccount.get(bankId).catch(() => null);
    if (!bank || bank.user_id !== user.id) {
      return Response.json({ error: 'Bank account not found.' }, { status: 404 });
    }

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter(
        { user_id: user.id },
        '-created_date',
        2,
      )
    )[0] || null;
    if (
      !profile?.provider_user_id ||
      (bank.provider_user_id && bank.provider_user_id !== profile.provider_user_id)
    ) {
      return Response.json({ error: 'Bank account ownership could not be verified.' }, { status: 409 });
    }

    if (action === 'set_primary') {
      if (bank.status !== 'verified') {
        return Response.json({ error: 'Only a verified bank can be selected.' }, { status: 409 });
      }
      if (!bank.is_primary) await setProviderPrimary(base44, user, profile, bank);
      await audit(base44, user.id, bank, 'primary_selected', 'provider_primary_confirmed');
      return Response.json({ success: true, action, bank_id: bank.id });
    }

    if (bank.status === 'deleted') {
      return Response.json({ success: true, action, bank_id: bank.id, already_disconnected: true });
    }

    const transactions = await base44.asServiceRole.entities.WalletTransaction.filter(
      { user_id: user.id, funding_source_id: bank.source_id },
      '-created_date',
      200,
    );
    const inFlight = transactions.some((transaction) =>
      ACTIVE_TRANSACTION_STATUSES.has(transaction.status) ||
      ACTIVE_INTEGRATION_STATUSES.has(transaction.integration_status)
    );
    if (inFlight) {
      return Response.json(
        { error: 'This bank has a transfer in progress. Disconnect it after the transfer finishes.' },
        { status: 409 },
      );
    }

    const allBanks = await base44.asServiceRole.entities.SeamlessBankAccount.filter(
      { user_id: user.id },
      '-verified_at',
      50,
    );
    let replacement = null;
    if (bank.is_primary) {
      for (const candidate of allBanks) {
        if (candidate.id === bank.id || candidate.status !== 'verified') continue;
        const authorization = await activeAuthorizationFor(base44, user.id, candidate.source_id);
        if (authorization?.provider_key === SEAMLESS_PLAID_PROVIDER_KEY) {
          replacement = candidate;
          break;
        }
      }
      if (replacement) await setProviderPrimary(base44, user, profile, replacement);
    }

    await seamlessRequest('POST', PATH_REMOVE_FUNDING_SOURCE, {
      user_id: profile.provider_user_id,
      source_id: bank.source_id,
    });

    const now = new Date().toISOString();
    await base44.asServiceRole.entities.SeamlessBankAccount.update(bank.id, {
      status: 'deleted',
      is_primary: false,
      provider_event_at: now,
      description: 'Disconnected by the authenticated player in ChessBet.',
    });

    const authorizations = await base44.asServiceRole.entities['ach-debit-authorization'].filter(
      { user_id: user.id, funding_source_id: bank.source_id, status: 'active' },
      '-accepted_at',
      20,
    );
    for (const authorization of authorizations) {
      await base44.asServiceRole.entities['ach-debit-authorization'].update(authorization.id, {
        status: 'revoked',
        revoked_at: now,
      });
    }

    // Disconnecting a bank leaves the independent Socure KYC result intact.

    await audit(base44, user.id, bank, 'disconnected', 'provider_removal_confirmed');
    return Response.json({
      success: true,
      action,
      bank_id: bank.id,
      replacement_bank_id: replacement?.id || '',
    });
  } catch (error) {
    const message = String(error?.message || '');
    console.error(JSON.stringify({
      event: 'seamless_bank_management_failed',
      reason: (message || 'unknown_error').slice(0, 240),
    }));
    if (message === 'bank_authorization_required') {
      return Response.json({ error: 'This bank must be reconnected before it can be used.' }, { status: 409 });
    }
    const status = Number(error?.publicStatus) || 502;
    return Response.json(
      { error: 'Seamless could not update this bank account. Please try again.' },
      { status },
    );
  }
});
