import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

// Sends the initial and subsequent SPA page_view events. The lightweight
// gtag queue exists immediately; the network library loads after first paint.
export default function GoogleAnalyticsTracker() {
  const { pathname, search } = useLocation();
  const lastPage = useRef(null);

  useEffect(() => {
    if (typeof window.gtag !== "function") return;
    const page = pathname + search;
    if (lastPage.current === page) return;
    lastPage.current = page;
    window.gtag("event", "page_view", {
      page_path: pathname + search,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, search]);

  return null;
}