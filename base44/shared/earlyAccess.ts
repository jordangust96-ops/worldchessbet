// ============================================================================
// EARLY ACCESS MODE — retained only as a controlled, explicit testing switch.
//
// Production-like sandbox behavior requires this to remain false. Every
// production eligibility and money-movement path must then enforce its own
// server-side provider checks. Do not enable it to work around missing
// provider configuration.
// Keep in sync with src/lib/appConfig.js (DEMO_MODE).
// ============================================================================
export const EARLY_ACCESS_MODE = false;

// Historical Early Access campaign amount. It is inert while
// EARLY_ACCESS_MODE is false and remains here only to preserve historical
// ledger interpretation and an explicit rollback path.
export const EARLY_ACCESS_STARTING_BALANCE = 500;