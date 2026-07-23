import { useEffect } from "react";
import { base44 } from "@/api/base44Client";

const SESSION_KEY = "chessbet_visit_session_id";
const LOGGED_KEY = "chessbet_visit_logged";

// Logs exactly one SiteVisit record per browser session (used to power the
// admin Site Activity dashboard). Fire-and-forget — never blocks rendering
// or surfaces an error to the user.
export default function useSiteVisitLogger() {
  useEffect(() => {
    if (sessionStorage.getItem(LOGGED_KEY)) return;
    let sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
    sessionStorage.setItem(LOGGED_KEY, "true");
    base44.entities.SiteVisit.create({ session_id: sessionId, path: window.location.pathname }).catch(() => {});
  }, []);
}