// Real Seamless ACH movement is deliberately opt-in in each direction. An
// absent, misspelled, or non-true value keeps that direction disabled. The
// switches remain independent so launch operations can stage and roll back
// deposits and withdrawals separately after provider approval.
function enabled(name: string) {
  return (Deno.env.get(name) || '').trim().toLowerCase() === 'true';
}

// Set only after Seamless's final integration contract and acceptance tests.
// Keep approval set during ordinary rollback; use direction switches instead
// so stopping new deposits never accidentally blocks required withdrawals.
export function seamlessProviderApproved() {
  return enabled('SEAMLESS_PROVIDER_APPROVED');
}

export function paidContestsEnabled() {
  return seamlessProviderApproved() && enabled('PAID_CONTESTS_ENABLED');
}

export function seamlessDepositsEnabled() {
  return seamlessProviderApproved() && enabled('SEAMLESS_DEPOSITS_ENABLED');
}

export function seamlessWithdrawalsEnabled() {
  return seamlessProviderApproved() && enabled('SEAMLESS_WITHDRAWALS_ENABLED');
}

export function seamlessRtpPayoutsEnabled() {
  return seamlessProviderApproved() && enabled('SEAMLESS_RTP_PAYOUTS_ENABLED');
}

// Separate provider-approval gate for ChessBet-owned bank verification. This
// remains false when absent so the unapproved endpoint is never called.
export function seamlessThirdPartyFundingEnabled() {
  return seamlessProviderApproved() && enabled('SEAMLESS_THIRD_PARTY_FUNDING_ENABLED');
}
