// Single source of truth for the 24-hour contest reporting window. Shared by
// submitContestReport (enforces the filing deadline) and the settlement /
// pending-winnings-release path (settleMatch, releasePendingWinnings,
// manageDisputeCase) so a payout's automatic hold can never expire before —
// or long after — the window in which a player is actually still allowed to
// file a report. Keeping both in one constant means they cannot drift apart.
export const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Small negative-skew tolerance for clock differences between the client and
// server when a deadline is computed from a client-supplied or just-written
// timestamp.
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
