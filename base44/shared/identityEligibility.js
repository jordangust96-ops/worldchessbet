export function isSocureIdentityVerified(user) {
  return !!user &&
    user.account_state === 'verified' &&
    user.identity_verification_status === 'verified' &&
    user.identity_verification_provider === 'socure' &&
    typeof user.identity_provider_reference === 'string' &&
    user.identity_provider_reference.length > 0;
}