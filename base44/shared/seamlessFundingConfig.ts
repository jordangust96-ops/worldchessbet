// Real Seamless ACH movement is deliberately opt-in in each direction. An
// absent, misspelled, or non-true value keeps that direction disabled. The
// switches remain independent so launch operations can stage and roll back
// deposits and withdrawals separately after provider approval.
function enabled(name: string) {
  return (Deno.env.get(name) || '').trim().toLowerCase() === 'true';
}

export function seamlessDepositsEnabled() {
  return enabled('SEAMLESS_DEPOSITS_ENABLED');
}

export function seamlessWithdrawalsEnabled() {
  return enabled('SEAMLESS_WITHDRAWALS_ENABLED');
}
