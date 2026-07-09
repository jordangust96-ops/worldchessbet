// Tracks whether the current logged-in session has completed the MFA
// second factor. Cleared on logout so the next login always re-requires it.
const KEY = "chessbet_mfa_verified";

export function isMfaVerified() {
  return localStorage.getItem(KEY) === "true";
}

export function setMfaVerified() {
  localStorage.setItem(KEY, "true");
}

export function clearMfaVerified() {
  localStorage.removeItem(KEY);
}