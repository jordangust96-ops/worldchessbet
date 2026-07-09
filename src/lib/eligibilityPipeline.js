import { base44 } from "@/api/base44Client";

// Eligibility Pipeline
//
// Runs before every deposit is executed. It knows nothing about any specific
// provider's business logic — it just runs an ordered list of validation
// steps, each returning { eligible, reason }, and stops at the first failure.
//
// Current order:
//   1. Geolocation Check (MaxMind) — every deposit
//   2. (future) Identity Verification (Plaid) — one-time
const steps = [runGeolocationCheck];

export async function runEligibilityPipeline(/* user, amount */) {
  for (const step of steps) {
    const result = await step();
    if (!result.eligible) return result;
  }
  return { eligible: true };
}

// Verifies the user is currently in an eligible jurisdiction via MaxMind.
// Fully self-contained: the pipeline only ever sees its eligible/reason result.
async function runGeolocationCheck() {
  const { data } = await base44.functions.invoke("checkGeolocation", {});
  if (data?.error) {
    return { eligible: false, reason: "Unable to verify your location right now. Please try again shortly." };
  }
  return { eligible: data.eligible, reason: data.reason };
}