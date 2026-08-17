import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackPixelPageView } from "@/lib/metaPixel";

// Sends a PageView on subsequent SPA route changes. The first page view is
// queued by deferredAnalytics before React mounts, so it is skipped here to
// avoid duplicate reporting.
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