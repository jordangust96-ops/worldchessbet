// Authentication events and pending-login analytics storage are no longer collected.
// Preserve the calling API so optional telemetry cannot affect authentication.
export function trackGoogleAnalyticsEvent() {}
export function rememberOAuthLogin() {}
export function clearPendingOAuthLogin() {
  try { sessionStorage.removeItem("chessbet_pending_oauth_login"); } catch {}
}
export function trackCompletedOAuthLogin() { clearPendingOAuthLogin(); }

