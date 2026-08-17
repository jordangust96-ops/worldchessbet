const GA_MEASUREMENT_ID = "G-JLHMN26FS2";
const META_PIXEL_ID = "1729629144899462";
const DEFER_AFTER_LOAD_MS = 3000;

function prepareGoogleAnalyticsQueue() {
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };

  window.gtag("js", new Date());
  // The SPA tracker sends the initial and subsequent page views. Disabling the
  // automatic config page view prevents double-counting after deferred load.
  window.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
}

function prepareMetaPixelQueue() {
  if (typeof window.fbq === "function") return;

  const fbq = function pixelQueue() {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
    else fbq.queue.push(arguments);
  };
  fbq.push = fbq;
  fbq.loaded = false;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;

  fbq("init", META_PIXEL_ID);
  fbq("track", "PageView");
}

function loadScript(id, src) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

export function scheduleDeferredAnalytics() {
  if (typeof window === "undefined") return;

  // Install tiny queues immediately so application events are retained even
  // though the third-party libraries themselves are not on the render path.
  prepareGoogleAnalyticsQueue();
  prepareMetaPixelQueue();

  let loaded = false;
  let timerId;

  const load = () => {
    if (loaded) return;
    loaded = true;
    if (timerId) window.clearTimeout(timerId);
    window.removeEventListener("pointerdown", load);
    window.removeEventListener("keydown", load);

    loadScript(
      "chessbet-ga4",
      `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
    );
    loadScript(
      "chessbet-meta-pixel",
      "https://connect.facebook.net/en_US/fbevents.js"
    );

    import("@heycatch/sdk")
      .then(({ analytics }) =>
        analytics.init({
          projectKey: "hck_pk_Q3LEgDjnK_AjVkiSmzmd6bQl0SEtDlNr",
          install: { framework: "vite-react", agent: "other" },
        })
      )
      .catch(() => {
        // Analytics must never delay or break the visitor experience.
      });
  };

  const schedule = () => {
    timerId = window.setTimeout(load, DEFER_AFTER_LOAD_MS);
  };

  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });

  // An engaged visitor should have tracking available promptly; passive
  // visitors keep all third-party downloads off the critical rendering path.
  window.addEventListener("pointerdown", load, { once: true, passive: true });
  window.addEventListener("keydown", load, { once: true });
}
