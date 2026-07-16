// Centralized jurisdiction configuration for the frontend.
//
// This mirrors — for display purposes only — the server-side whitelist that
// is authoritatively enforced in the getCurrentJurisdiction backend
// function. The frontend never makes or enforces this decision itself; it
// only reflects whatever status the server returns. To launch in an
// additional state, update the whitelist in getCurrentJurisdiction's
// APPROVED_STATES — never hard-code state names anywhere else.
export const APPROVED_STATES = ["AR", "CO", "GA", "IA", "KS", "ND", "TX", "VA", "WI", "WY"];

export const JURISDICTION_STATUS = {
  APPROVED: "approved",
  BLOCKED: "blocked",
  UNKNOWN: "unknown",
  VERIFICATION_FAILED: "verification_failed",
};

export const BLOCKED_MESSAGE =
  "Paid contests are not currently available in your jurisdiction. ChessBet currently offers paid gameplay only in approved jurisdictions. Your account remains active for informational purposes, but paid contests are unavailable from your current location.";

export const UNKNOWN_MESSAGE =
  "We could not verify your current location. Please disable any VPN, proxy, or location-masking software and try again.";

// Returns the correct user-facing message for a given jurisdiction status.
// Approved returns an empty string since no message should be shown.
export function getJurisdictionMessage(status) {
  if (status === JURISDICTION_STATUS.APPROVED) return "";
  if (status === JURISDICTION_STATUS.BLOCKED) return BLOCKED_MESSAGE;
  return UNKNOWN_MESSAGE; // unknown or verification_failed (VPN/proxy, lookup failure)
}