import { canTrack, safePage } from "./privacy";
const GA_ID = "G-JLHMN26FS2";
let lastGA = "", lastMeta = "";
function script(id, src) {
  if (document.getElementById(id)) return;
  const el = document.createElement("script");
  el.id = id; el.async = true; el.src = src;
  document.head.appendChild(el);
}
export function syncOptionalAnalytics() {
  if (canTrack("analytics")) {
    window["ga-disable-" + GA_ID] = false;
    if (!window.gtag) {
      window.dataLayer = [];
      window.gtag = function() { window.dataLayer.push(arguments); };
      window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      window.gtag("js", new Date());
      window.gtag("config", GA_ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_expires: 15552000, ...safePage() });
      window.__chessbetTrackingLoaded = true;
      script("chessbet-ga4", "https://www.googletagmanager.com/gtag/js?id=" + GA_ID);
    }
    if (lastGA !== location.pathname) {
      lastGA = location.pathname;
      window.gtag("event", "page_view", safePage());
    }
  }
  // Meta reads the document URL itself. Never load it on URLs with parameters.
  if (canTrack("marketing") && !location.search && !location.hash) {
    if (!window.fbq) {
      const fbq = function() { if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments); else fbq.queue.push(arguments); };
      fbq.push = fbq; fbq.loaded = true; fbq.version = "2.0"; fbq.queue = [];
      window.fbq = fbq; window._fbq = fbq;
      fbq("consent", "grant");
      fbq("set", "autoConfig", false, "1729629144899462");
      fbq("init", "1729629144899462");
      window.__chessbetTrackingLoaded = true;
      script("chessbet-meta-pixel", "https://connect.facebook.net/en_US/fbevents.js");
    }
    if (lastMeta !== location.pathname) { lastMeta = location.pathname; window.fbq("track", "PageView"); }
  }
}
export function scheduleDeferredAnalytics() {
  window.addEventListener("chessbet:privacy-change", syncOptionalAnalytics);
}

