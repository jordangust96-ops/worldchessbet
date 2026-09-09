function retentionUntil(activityAt: string) {
  const date = new Date(activityAt);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid compliance activity timestamp');
  date.setUTCFullYear(date.getUTCFullYear() + 2);
  return date.toISOString();
}

// Extends the retained evidence for the exact Seamless funding source used by
// a transfer. The verified bank record must originate from the authenticated
// Seamless webhook, and deposits additionally require the user's standing ACH
// clickwrap authorization to be bound to that source.
export async function extendComplianceEvidenceRetention(base44: any, {
  userId,
  fundingSourceId,
  activityAt = new Date().toISOString(),
  requireAchAuthorization = false,
}: {
  userId: string;
  fundingSourceId: string;
  activityAt?: string;
  requireAchAuthorization?: boolean;
}) {
  const deadline = retentionUntil(activityAt);
  const banks = await base44.asServiceRole.entities.SeamlessBankAccount.filter(
    { user_id: userId, source_id: fundingSourceId, status: 'verified' },
    '-verified_at',
    2
  );
  const bank = banks.find((row: any) =>
    row.user_id === userId &&
    row.source_id === fundingSourceId &&
    row.status === 'verified' &&
    !!row.verified_at &&
    !!row.last_provider_event_id
  );
  if (!bank) throw new Error('retained Seamless Plaid verification evidence is required');

  const authorizations = await base44.asServiceRole.entities['ach-debit-authorization'].filter(
    { user_id: userId, funding_source_id: fundingSourceId, status: 'active' },
    '-accepted_at',
    10
  );
  const authorization = authorizations.find((row: any) =>
    row.provider_key === 'seamless_ach_plaid' &&
    row.provider_user_id === bank.provider_user_id &&
    !!row.authorization_text &&
    !!row.signer_name
  );
  if (requireAchAuthorization && !authorization) {
    throw new Error('active ACH debit authorization is required');
  }
  if (authorization) {
    await base44.asServiceRole.entities['ach-debit-authorization'].update(authorization.id, {
      last_transaction_at: activityAt,
      retention_until: deadline,
    });
  }

  return {
    provider_verification_id: bank.id,
    authorization_id: authorization?.id || '',
    retention_until: deadline,
  };
}
