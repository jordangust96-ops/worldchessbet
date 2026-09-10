import { hasVerifiedIdentity, KYC_POLICY_VERSION } from './identityEligibility.js';
import { identityConfig } from './socureIdentity.ts';
export async function identityState(base44, user) {
  const current = await base44.asServiceRole.entities.User.get(user.id);
  const verified = await hasVerifiedIdentity(base44, current);
  const rows = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
    { user_id: current.id, policy_version: KYC_POLICY_VERSION }, '-requested_at', 1
  );
  const row = rows[0];
  let status = verified ? 'verified' : row?.status || 'not_started';
  // Never treat a missing/delayed result as proof that the player abandoned verification.
  const submitted = !!row?.completed_at || ['verified','rejected','review_required'].includes(row?.status);
  if (status === 'pending' && !submitted && row?.failure_code === 'hosted_verification_incomplete' &&
      Date.now() - Date.parse(row.provider_checked_at || '') < 60000) status = 'incomplete';
  if (!verified && status === 'verified') status = 'expired';
  let enabled = false;
  try { enabled = identityConfig().enabled; } catch { /* Fail closed with usable wallet status. */ }
  const ageBlocked = row?.age_verified === true && row?.age_over_21 !== true;
  const messages = {
    not_started: 'Verify your identity and confirm you are 21 or older to fund your wallet and play for money.',
    pending: 'Your verification is pending. If you finished the secure Socure flow, no further action is needed while we wait for the result.',
    verified: 'Your identity and age have been verified.',
    expired: 'Your verification session expired. Start again to continue.',
    failed: 'Verification could not be completed. Please try again or contact support.',
    rejected: 'We could not approve your verification. Contact hello@worldchessbet.com for help.',
    review_required: row?.failure_code === 'verified_age_evidence_missing'
      ? 'Your identity result needs an age-verification review. Contact hello@worldchessbet.com.'
      : 'Your verification is under review. We will update your status once it is resolved.',
  };
  return { enabled, submitted, status: ageBlocked ? 'rejected' : status, verified: verified && !ageBlocked,
    minimum_age: 21, can_start: enabled && !verified && !submitted && !ageBlocked && ['not_started','incomplete','expired','failed'].includes(status) &&
      !['suspended','closed'].includes(current.account_state) && !current.withdrawal_hold,
    message: ageBlocked ? 'ChessBet currently requires players to be 21 or older for real-money activity.' : messages[status] || messages.review_required };
}
