const KEY = "chessbet_mfa_session_token";

export function getMfaSessionToken() {
  return sessionStorage.getItem(KEY) || "";
}

export function isMfaVerified() {
  return Boolean(getMfaSessionToken());
}

export function setMfaVerified(sessionToken) {
  if (typeof sessionToken !== "string" || sessionToken.length < 32) {
    throw new Error("A valid server-issued MFA session is required");
  }
  sessionStorage.setItem(KEY, sessionToken);
}

export function clearMfaVerified() {
  sessionStorage.removeItem(KEY);
}
