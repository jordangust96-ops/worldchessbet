import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Sends a page_view event to GA4 on every route change, since gtag.js's
// initial pageview only fires once on the first load of this SPA.
export default function GoogleAnalyticsTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", "page_view", {
      page_path: pathname + search,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, search]);

  return null;
}