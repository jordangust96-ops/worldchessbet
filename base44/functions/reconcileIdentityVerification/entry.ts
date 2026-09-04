import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Scheduled sweep (see base44/workflows/IdentityVerificationReconciliation.jsonc):
// re-syncs each User's denormalized identity_verification_status/account_state
// snapshot against the SocureIdentityVerification record it was last set from.
//
// Nothing in this codebase can currently change a SocureIdentityVerification
// out from under a 'verified' User snapshot -- socureIdentityWebhook's own
// terminal-state guard (see OPEN_IDENTITY_VERIFICATION_STATES there) refuses
// to apply ANY further decision once a verification record reaches a
// terminal outcome, and no other code path writes to SocureIdentityVerification
// at all. That is exactly the kind of invariant a future change (a genuine
// Socure revoke/re-review event type, a manual data correction, a migration)
// can quietly break without anyone noticing -- a user would stay eligible to
// deposit, withdraw, and enter paid contests under an identity verification
// that is no longer valid, with nothing in the system able to tell. This
// sweep is the safety net: it never assumes "nothing changes it", it checks.
//
// Fails safe in one direction only: it can downgrade a user OUT of
// 'verified' when the record it was verified from no longer says 'verified'
// (or no longer exists), but it never promotes a user INTO 'verified' --
// that stays the exclusive job of socureIdentityWebhook, which alone
// captures the compliance evidence (encrypted provider report, retention)
// a passing decision requires.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const socureUsers = await base44.asServiceRole.entities.User.filter(
      { identity_verification_provider: 'socure' },
      '-updated_date',
      500
    );

    let checked = 0;
    const driftedIds: string[] = [];

    for (const user of socureUsers) {
      checked += 1;
      if (!user.identity_provider_reference) continue;

      const matches = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
        { provider_evaluation_id: user.identity_provider_reference },
        '-created_date',
        1
      );
      const verification = matches[0] || null;

      // A promotion is permitted only when the verification record itself is an
      // accepted Socure result and its evidence is retained, or when an
      // administrator has recorded an explicit provider-console reconciliation.
      // This prevents a plain client-side or data-only status change from
      // becoming an eligibility grant.
      let trustedAcceptance =
        verification?.status === 'verified' &&
        verification?.provider_decision === 'ACCEPT' &&
        !!verification?.provider_report_ciphertext;
      if (!trustedAcceptance && verification?.status === 'verified' && verification?.provider_decision === 'ACCEPT') {
        const reconciliations = await base44.asServiceRole.entities.IntegrationEvent.filter(
          { idempotency_key: `socure.identity.console-reconcile:${verification.id}` },
          '-created_date',
          1
        );
        trustedAcceptance = reconciliations.length > 0;
      }

      if (trustedAcceptance) {
        const needsPromotion =
          user.identity_verification_status !== 'verified' ||
          user.account_state === 'provisional';
        if (needsPromotion) {
          await base44.asServiceRole.entities.User.update(user.id, {
            identity_verification_status: 'verified',
            identity_verification_provider: 'socure',
            identity_provider_reference: verification.provider_evaluation_id,
            identity_verified_at: user.identity_verified_at || verification.completed_at || new Date().toISOString(),
            // Never override a compliance suspension/closure; only normalize a
            // provisional account whose accepted verification is now trusted.
            account_state: user.account_state === 'provisional' ? 'verified' : user.account_state,
          });
          driftedIds.push(user.id);
          await base44.asServiceRole.entities.IntegrationEvent.create({
            event_type: 'identity.socure_snapshot_reconciled',
            occurred_at: new Date().toISOString(),
            aggregate_type: 'user',
            aggregate_id: user.id,
            correlation_id: verification.id,
            idempotency_key: `socure.identity.snapshot-reconcile:${verification.id}`,
            actor_type: 'system',
            user_id: user.id,
            status: 'verified',
            result: 'ACCEPT',
            event_data_json: JSON.stringify({
              provider: 'socure',
              verification_id: verification.id,
              evaluation_id: verification.provider_evaluation_id,
              evidence_source: verification.provider_report_ciphertext ? 'encrypted_webhook_report' : 'administrator_console_reconciliation',
            }),
            description: 'User identity snapshot reconciled to an accepted Socure verification record.',
          });
        }
        continue;
      }

      // Pending/rejected/failed records do not promote a user. Only correct a
      // stale positive snapshot, never lower unrelated account restrictions.
      if (user.identity_verification_status !== 'verified') continue;
      const newIdentityStatus = verification?.status || 'failed';
      const userUpdates: Record<string, unknown> = { identity_verification_status: newIdentityStatus };
      if (user.account_state === 'verified') userUpdates.account_state = 'provisional';

      await base44.asServiceRole.entities.User.update(user.id, userUpdates);
      driftedIds.push(user.id);
      await base44.asServiceRole.entities.IntegrityFlag.create({
        user_id: user.id,
        flag_type: 'manual',
        severity: 'high',
        status: 'open',
        description: 'Identity verification snapshot drift detected and corrected.',
        notes:
          `reconcileIdentityVerification: User.identity_verification_status was 'verified' (provider_reference ${user.identity_provider_reference}) but the underlying SocureIdentityVerification record is now '${verification?.status || 'missing'}'. ` +
          `Downgraded identity_verification_status to '${newIdentityStatus}'${userUpdates.account_state ? ` and account_state to '${userUpdates.account_state}'` : ' (account_state was already not verified)'}.`,
      });
    }

    return Response.json({ checked, drifted: driftedIds.length, driftedIds });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
