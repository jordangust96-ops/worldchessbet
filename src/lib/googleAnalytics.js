// Small GA4-only helper. Event parameters intentionally exclude email, user IDs,
// usernames, and other personally identifiable information.
const PENDING_OAUTH_LOGIN_KEY = "chessbet_pending_oauth_login";
const OAUTH_LOGIN_MAX_AGE_MS = 30 * 60 * 1000;

export function trackGoogleAnalyticsEvent(eventName, properties = {}) {
  if (typeof window === "undefined") return;
  const gtag = (/** @type {any} */ (window)).gtag;
  if (typeof gtag !== "function") return;
  gtag("event", eventName, properties);
}

export function rememberOAuthLogin(method) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      PENDING_OAUTH_LOGIN_KEY,
      JSON.stringify({ method, startedAt: Date.now() })
    );
  } catch {
    // Analytics must never block authentication.
  }
}

export function clearPendingOAuthLogin() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_OAUTH_LOGIN_KEY);
  } catch {
    // Analytics must never block authentication.
  }
}

export function trackCompletedOAuthLogin() {
  if (typeof window === "undefined") return;

  let pending;
  try {
    const raw = window.sessionStorage.getItem(PENDING_OAUTH_LOGIN_KEY);
    window.sessionStorage.removeItem(PENDING_OAUTH_LOGIN_KEY);
    if (!raw) return;
    pending = JSON.parse(raw);
  } catch {
    return;
  }

  if (
    typeof pending?.method !== "string" ||
    typeof pending?.startedAt !== "number" ||
    Date.now() - pending.startedAt > OAUTH_LOGIN_MAX_AGE_MS
  ) {
    return;
  }

  trackGoogleAnalyticsEvent("login", { method: pending.method });
}
