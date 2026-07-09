// Eligibility Pipeline
//
// Runs before every deposit is executed. This is the single insertion point
// for future compliance checks:
//   - Identity Verification (one-time, via Plaid) — future
//   - Geolocation Check (every deposit, via MaxMind) — future
//
// For now this always passes through immediately. handleDeposit() in the
// Wallet page should never know about identity/geolocation logic directly —
// it only executes once this pipeline resolves as eligible.
export async function runEligibilityPipeline(/* user, amount */) {
  // Placeholder: future steps will run identity verification (if not yet
  // verified) and a fresh geolocation check here, returning
  // { eligible: false, reason: '...' } when a check fails.
  return { eligible: true };
}