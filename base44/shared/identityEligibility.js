// Bank authorization is never evidence of player KYC.
export const KYC_POLICY_VERSION = 'socure-kyc-age-v1';
export function isSocureIdentityVerified(user) {
  return !!user && user.account_state === 'verified' &&
    user.identity_verification_status === 'verified' &&
    user.identity_verification_provider === 'socure' &&
    user.identity_policy_version === KYC_POLICY_VERSION &&
    !!user.identity_legal_name && !!user.identity_provider_reference && user.identity_age_verified === true && user.identity_age_over_21 === true;
}
// Compatibility export for callers during the migration; semantics are KYC only.
export const isSeamlessPlaidVerified = isSocureIdentityVerified;

export function isVerifiedKycEvidence(row, user, now = Date.now()) {
  return isSocureIdentityVerified(user) && !!row &&
    row.verified_legal_name === user.identity_legal_name &&
    row.user_id === user.id && row.provider_evaluation_id === user.identity_provider_reference &&
    row.workflow === 'consumer_onboarding' && row.environment === 'production' &&
    row.policy_version === KYC_POLICY_VERSION && row.status === 'verified' &&
    row.provider_decision === 'ACCEPT' && row.age_verified === true && row.age_over_21 === true &&
    !!row.webhook_event_id && !!row.provider_report_ciphertext &&
    !!row.provider_report_sha256 && Number.isFinite(Date.parse(row.verified_valid_until || '')) &&
    Date.parse(row.verified_valid_until) > now;
}
export async function hasVerifiedIdentity(base44, user) {
  if (!user?.id) return false;
  const current = await base44.asServiceRole.entities.User.get(user.id);
  if (!isSocureIdentityVerified(current)) return false;
  const rows = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
    { user_id: current.id, provider_evaluation_id: current.identity_provider_reference }, '-requested_at', 1
  );
  return isVerifiedKycEvidence(rows[0], current);
}

