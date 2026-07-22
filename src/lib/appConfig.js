// Single global flag controlling ChessBet's pre-launch/demo state — shows the
// early access notice app-wide AND (together with the backend's mirrored
// EARLY_ACCESS_MODE flag in base44/shared/earlyAccess.ts) grants new wallets
// a testing balance instead of requiring a real deposit. Flip to false at
// launch. Keep this in sync with base44/shared/earlyAccess.ts.
export const DEMO_MODE = true;

// Starting demo balance (USD) granted to a brand-new wallet while DEMO_MODE
// is enabled. Keep in sync with base44/shared/earlyAccess.ts
// (EARLY_ACCESS_STARTING_BALANCE).
export const EARLY_ACCESS_STARTING_BALANCE = 500;