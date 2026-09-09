import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const PROVIDER = 'seamless_ach_plaid';

function publicStatus(source: any) {
  if (!source) return 'failed';
  if (source.status === 'verified') return 'verified';
  if (['added', 'pending_verification'].includes(source.status)) return 'pending';
  if (source.status === 'verification_expired') return 'expired';
  return 'failed';
}

// Scheduled safety sweep: the denormalized User eligibility snapshot must agree
// with a webhook-evidenced Seamless funding source. It can never promote from a
// browser redirect, client write, or an unverified bank record.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const users = await base44.asServiceRole.entities.User.filter(
      { identity_verification_provider: PROVIDER },
      '-updated_date',
      500
    );

    let checked = 0;
    const driftedIds: string[] = [];

    for (const user of users) {
      checked += 1;
      const sourceId = String(user.identity_provider_reference || '');
      const matches = sourceId
        ? await base44.asServiceRole.entities.SeamlessBankAccount.filter(
            { user_id: user.id, source_id: sourceId },
            '-updated_date',
            1
          )
        : [];
      const source = matches.find((record: any) =>
        record.user_id === user.id && record.source_id === sourceId
      ) || null;
      const trusted = source?.status === 'verified' &&
        !!source.verified_at &&
        !!source.last_provider_event_id;

      if (trusted) {
        const needsPromotion =
          user.identity_verification_status !== 'verified' ||
          user.account_state === 'provisional';
        if (!needsPromotion) continue;

        await base44.asServiceRole.entities.User.update(user.id, {
          identity_verification_status: 'verified',
          identity_verification_provider: PROVIDER,
          identity_provider_reference: source.source_id,
          identity_verified_at: user.identity_verified_at || source.verified_at,
          account_state: user.account_state === 'provisional' ? 'verified' : user.account_state,
        });
        driftedIds.push(user.id);
        await base44.asServiceRole.entities.IntegrationEvent.create({
          event_type: 'account.seamless_plaid_snapshot_reconciled',
          occurred_at: new Date().toISOString(),
          aggregate_type: 'user',
          aggregate_id: user.id,
          correlation_id: source.source_id,
          idempotency_key: `seamless.plaid.snapshot-reconcile:${source.last_provider_event_id}`,
          actor_type: 'system',
          user_id: user.id,
          status: 'verified',
          result: 'verified',
          event_data_json: JSON.stringify({
            provider: PROVIDER,
            funding_source_id: source.source_id,
            provider_event_id: source.last_provider_event_id,
          }),
          description: 'Player eligibility reconciled to a webhook-verified Seamless bank account.',
        });
        continue;
      }

      if (user.identity_verification_status !== 'verified' && user.account_state !== 'verified') continue;
      const nextStatus = source?.status === 'verified' ? 'review_required' : publicStatus(source);
      const updates: Record<string, unknown> = { identity_verification_status: nextStatus };
      if (user.account_state === 'verified') updates.account_state = 'provisional';
      await base44.asServiceRole.entities.User.update(user.id, updates);
      driftedIds.push(user.id);
      await base44.asServiceRole.entities.IntegrityFlag.create({
        user_id: user.id,
        flag_type: 'manual',
        severity: 'high',
        status: 'open',
        description: 'Hosted bank-verification snapshot drift detected and corrected.',
        notes:
          `User eligibility referenced funding source ${sourceId || 'missing'}, but the stored source state is '${source?.status || 'missing'}'. ` +
          `Eligibility was downgraded to '${nextStatus}'.`,
      });
    }

    return Response.json({ checked, drifted: driftedIds.length, driftedIds });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
