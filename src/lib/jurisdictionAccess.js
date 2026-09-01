// Pure, no-React jurisdiction-access decision helper and a module-scoped
// in-flight deduplicator for the authenticated MaxMind access check.
//
// The decision (`evaluateJurisdictionAccess`) is intentionally pure so it can
// be unit-tested with no network. It reuses the existing exact ten-state
// allowlist from src/lib/jurisdictionConfig.js (which mirrors the
// authoritative server-side whitelist in getCurrentJurisdiction) rather than
// redefining a list anywhere else.

import { APPROVED_STATES } from "./jurisdictionConfig.js";

// Top-level anonymizer/proxy boolean fields that may appear on a
// getCurrentJurisdiction response. `vpnDetected` is the aggregate the server
// already computes; the granular signals are checked too so a future response
// shape can never silently admit an anonymizer.
const ANONYMIZER_SIGNALS = [
  "vpnDetected",
  "isAnonymousVpn",
  "isAnonymousProxy",
  "isPublicProxy",
  "isHostingProvider",
  "isAnonymous",
  "isTorExitNode",
  "isResidentialProxy",
  "isSatelliteProvider",
];

// Safe, non-diagnostic user-facing reasons. Never expose IP/provider/lookup
// details; these mirror the existing public messaging in jurisdictionConfig.
const REASON_UNAVAILABLE =
  "ChessBet is not currently available in your location. Paid contests are offered only in approved U.S. jurisdictions.";
const REASON_UNVERIFIED =
  "We could not verify your current location. Please disable any VPN, proxy, or location-masking software and try again.";
const REASON_BLOCKED =
  "Unfortunately, real-money play is not currently available in your location. ChessBet has not yet enabled real-money play in your state or country under its current launch requirements.";

// Returns { allowed, reason }.
//
// allowed is true ONLY when every one of the following holds:
//   - response exists;
//   - response.enforcementEnabled === true;
//   - response.status === 'approved' && response.approved === true;
//   - response.country === 'US';
//   - response.state is in APPROVED_STATES;
//   - response.vpnDetected is not true; and no supported top-level
//     anonymizer/proxy boolean on the response is true.
//
// Every other case (missing, disabled, unknown, blocked, verification_failed,
// non-US, unapproved state, VPN/proxy/anonymizer) returns allowed:false with a
// safe user-facing reason and no raw IP/provider diagnostics.
// Returns { allowed, reason, promptEligible }.
//
// allowed is true ONLY when enforcement is on, status is approved/approved,
// country is US, state is in APPROVED_STATES, and no anonymizer signal is set.
//
// promptEligible is true ONLY when the jurisdiction response POSITIVELY
// determined the user is outside the approved jurisdictions — i.e. the server
// returned status "blocked" with enforcement on and no anonymizer. The server
// emits "blocked" only when a real country+state were detected (never for
// VPN/proxy/anonymizer, which map to verification_failed, or unknown/missing
// location, which map to unknown). Users in this state may be invited to opt in
// to the jurisdiction interest waitlist. Every other blocked case (disabled
// enforcement, unknown, verification_failed, VPN/proxy, missing location) is
// NEVER prompted — those remain available:false with promptEligible:false.
export function evaluateJurisdictionAccess(response) {
  if (!response || typeof response !== "object") {
    return { allowed: false, reason: REASON_UNVERIFIED, promptEligible: false };
  }

  // Platform administrators are allowed through regardless of detected
  // location before a protected action. The server (getCurrentJurisdiction) sets
  // adminBypass and skips MaxMind for any user whose role is "admin".
  if (response.adminBypass === true) {
    return { allowed: true, reason: "", promptEligible: false };
  }

  if (response.enforcementEnabled !== true) {
    return { allowed: false, reason: REASON_UNAVAILABLE, promptEligible: false };
  }

  // Anonymizer/proxy/VPN signals are never allowed and never prompt, even if a
  // real location was detected.
  for (const key of ANONYMIZER_SIGNALS) {
    if (response[key] === true) {
      return { allowed: false, reason: REASON_UNVERIFIED, promptEligible: false };
    }
  }

  if (
    response.status === "approved" &&
    response.approved === true &&
    response.country === "US" &&
    APPROVED_STATES.includes(response.state)
  ) {
    return { allowed: true, reason: "", promptEligible: false };
  }

  // Positively determined outside the approved jurisdictions.
  if (response.status === "blocked") {
    return { allowed: false, reason: REASON_BLOCKED, promptEligible: true };
  }

  // unknown / verification_failed / non-US / approved-but-unapproved-state edge.
  return { allowed: false, reason: REASON_UNAVAILABLE, promptEligible: false };
}

// Module-scoped Map of in-flight jurisdiction-check promises, keyed by the
// authenticated user id. Lets concurrent guard mounts (React StrictMode /
// concurrent rendering) for the same user share a single provider call.
const inflight = new Map();

// Deduplicates concurrent jurisdiction checks for one user.
//
// - userId must be a non-empty string; an empty/missing userId is a programmer
//   error and returns a rejected promise (no Map entry is created).
// - invokeFn is called exactly once per outstanding user key.
// - The SAME promise is returned to every concurrent caller for that user.
// - In `finally`, only that same promise is deleted from the Map — a later
//   call that already started a fresh promise is left untouched.
// - No resolved approval, session, or local-storage data is retained; the
//   settled value is delivered to callers and the Map holds nothing after.
export function getJurisdictionCheck(userId, invokeFn) {
  if (!userId || typeof userId !== "string") {
    return Promise.reject(new Error("Jurisdiction access check requires an authenticated user id."));
  }

  const existing = inflight.get(userId);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(() => invokeFn())
    .finally(() => {
      // Delete only the promise we stored, so a newer call that replaced it
      // (or a call that started after settlement) is not disturbed.
      if (inflight.get(userId) === promise) inflight.delete(userId);
    });

  inflight.set(userId, promise);
  return promise;
}