// Real Seamless ACH debit submission is deliberately opt-in. An absent,
// misspelled, or non-true value keeps deposits disabled.
export function seamlessDepositsEnabled() {
  return (Deno.env.get('SEAMLESS_DEPOSITS_ENABLED') || '').trim().toLowerCase() === 'true';
}
