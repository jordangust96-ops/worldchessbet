// Thin wrapper around the Meta Pixel (fbq) queue installed before React mounts.
// Every call is guarded so a missing/blocked pixel (ad blockers, consent
// declined) never throws or breaks the calling flow.

// Standard Meta events get 'track'; every ChessBet-specific funnel step uses
// 'trackCustom' with the exact event name so they show up distinctly in
// Meta Events Manager without colliding with standard event semantics.
const STANDARD_EVENTS = new Set(["PageView", "CompleteRegistration"]);

export function trackPixelEvent(eventName, params = {}) {
  if (typeof window === "undefined") return;
  const fbq = (/** @type {any} */ (window)).fbq;
  if (typeof fbq !== "function") return;
  if (STANDARD_EVENTS.has(eventName)) {
    fbq("track", eventName, params);
  } else {
    fbq("trackCustom", eventName, params);
  }
}

export function trackPixelPageView() {
  trackPixelEvent("PageView");
}