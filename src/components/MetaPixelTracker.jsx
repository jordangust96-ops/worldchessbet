import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackPixelPageView } from "@/lib/metaPixel";

// Mirrors GoogleAnalyticsTracker: sends a PageView on every subsequent route
// change in this SPA. The very first load already gets its PageView from the
// base pixel snippet in index.html, so that one is skipped here to avoid a
// duplicate fire.
export default function MetaPixelTracker() {
  const { pathname, search } = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    trackPixelPageView();
  }, [pathname, search]);

  return null;
}