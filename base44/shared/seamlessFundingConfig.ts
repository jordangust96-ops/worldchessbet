// Real Seamless ACH movement remains opt-in by direction. Hosted Plaid bank
// authorization is safe to expose whenever the approved Seamless environment
// and both API keys are configured; it does not itself move money.
function enabled(name: string) {
  return (Deno.env.get(name) || '').trim().toLowerCase() === 'true';
}

function configured(name: string) {
  return !!(Deno.env.get(name) || '').trim();
}

export function seamlessProviderApproved() {
  return enabled('SEAMLESS_PROVIDER_APPROVED');
}

function productionMoneyMovementConfigured() {
  return (Deno.env.get('SEAMLESS_ACH_ENV') || '').trim().toLowerCase() === 'production' &&
    configured('SEAMLESS_ACH_PUBLIC_KEY') &&
    configured('SEAMLESS_ACH_SECRET_KEY');
}

export function paidContestsEnabled() {
  return seamlessProviderApproved() && productionMoneyMovementConfigured() && enabled('PAID_CONTESTS_ENABLED');
}

export function seamlessDepositsEnabled() {
  return seamlessProviderApproved() && productionMoneyMovementConfigured() && enabled('SEAMLESS_DEPOSITS_ENABLED');
}

export function seamlessWithdrawalsEnabled() {
  return seamlessProviderApproved() && productionMoneyMovementConfigured() && enabled('SEAMLESS_WITHDRAWALS_ENABLED');
}

export function seamlessRtpPayoutsEnabled() {
  return seamlessProviderApproved() && productionMoneyMovementConfigured() && enabled('SEAMLESS_RTP_PAYOUTS_ENABLED');
}

export function seamlessHostedPlaidEnabled() {
  const environment = (Deno.env.get('SEAMLESS_ACH_ENV') || '').trim().toLowerCase();
  return ['sandbox', 'production'].includes(environment) &&
    configured('SEAMLESS_ACH_PUBLIC_KEY') &&
    configured('SEAMLESS_ACH_SECRET_KEY');
}
