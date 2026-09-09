export const SEAMLESS_PLAID_IDENTITY_PROVIDER = 'seamless_ach_plaid';

// ChessBet treats only a verified Seamless funding source produced by the
// hosted Plaid flow as the account-verification signal for money movement.
// The webhook, never the browser callback, writes this snapshot.
export function isSeamlessPlaidVerified(user) {
  return !!user &&
    user.account_state === 'verified' &&
    user.identity_verification_status === 'verified' &&
    user.identity_verification_provider === SEAMLESS_PLAID_IDENTITY_PROVIDER &&
    typeof user.identity_provider_reference === 'string' &&
    user.identity_provider_reference.length > 0;
}
