import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { syncOptionalAnalytics } from "@/lib/deferredAnalytics";
export default function GoogleAnalyticsTracker() {
  const { pathname, search } = useLocation();
  useEffect(() => { syncOptionalAnalytics(); }, [pathname, search]);
  return null;
}
