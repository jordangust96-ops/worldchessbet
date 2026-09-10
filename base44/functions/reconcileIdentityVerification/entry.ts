import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { isVerifiedKycEvidence, KYC_POLICY_VERSION } from '../../shared/identityEligibility.js';
// The scheduled sweep may revoke drifted snapshots; it never promotes bank verification to KYC.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    let checked = 0, revoked = 0, skip = 0;
    while (true) {
      const users = await base44.asServiceRole.entities.User.list('id', 100, skip);
      for (const user of users) {
        checked++;
        if (user.identity_verification_status !== 'verified') continue;
        const rows = user.identity_verification_provider === 'socure'
          ? await base44.asServiceRole.entities.SocureIdentityVerification.filter(
              { user_id: user.id, provider_evaluation_id: user.identity_provider_reference }, '-requested_at', 1) : [];
        if (isVerifiedKycEvidence(rows[0], user)) continue;
        await base44.asServiceRole.entities.User.update(user.id, {
          identity_verification_status: 'not_started', identity_age_verified: false,
          identity_age_over_18: false, identity_age_over_21: false,
          identity_policy_version: KYC_POLICY_VERSION,
          ...(user.account_state === 'verified' ? { account_state: 'provisional' } : {}),
        });
        revoked++;
      }
      if (users.length < 100) break;
      skip += users.length;
    }
    return Response.json({ success: true, checked, revoked });
  } catch { return Response.json({ error: 'Identity reconciliation unavailable' }, { status: 503 }); }
});

