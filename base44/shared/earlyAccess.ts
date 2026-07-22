// ============================================================================
// EARLY ACCESS MODE — the single point of control for every pre-launch
// compliance bypass across the backend.
//
// While true, this flag causes every paid-flow compliance gate on the
// platform — identity verification (Plaid), geolocation enforcement
// (MaxMind), bank account linking, and Finix payment processing — to be
// bypassed, so the app behaves as a fully playable beta WITHOUT removing or
// altering any of the underlying production integration code. Affected
// functions still run their real checks and log the outcome; only the
// decision to actually block the user is skipped while this flag is true.
//
// MUST be switched to false before public production launch. Doing so
// restores full enforcement everywhere with no other code changes required,
// because every gate in the app funnels through this single flag.
//
// Keep in sync with the frontend equivalent: src/lib/appConfig.js (DEMO_MODE).
// ============================================================================
export const EARLY_ACCESS_MODE = true;

// Starting demo balance (USD) granted to a brand-new wallet while Early
// Access Mode is enabled, so users can exercise the full contest flow
// (hosting, joining, settling matches) without a real deposit / Finix
// payment. Ignored once EARLY_ACCESS_MODE is false.
// Keep in sync with src/lib/appConfig.js (EARLY_ACCESS_STARTING_BALANCE).
export const EARLY_ACCESS_STARTING_BALANCE = 500;