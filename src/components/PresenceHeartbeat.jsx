import { useEffect } from "react";
import { base44 } from "@/api/base44Client";

const HEARTBEAT_INTERVAL_MS = 45 * 1000;

// Stamps the current user's last_active_at while ChessBet is open, so backend
// notification logic can reliably tell whether a user is genuinely away
// instead of relying on component mount/unmount timing.
export default function PresenceHeartbeat() {
  useEffect(() => {
    let requestInFlight = false;

    const ping = async () => {
      // A background tab left open for hours is not an active player. It will
      // naturally age out of the backend's two-minute online window.
      if (document.visibilityState !== "visible" || requestInFlight) return;
      requestInFlight = true;
      try {
        await base44.auth.updateMe({ last_active_at: new Date().toISOString() });
      } catch {
        // Presence is best-effort and must never interrupt the user experience.
      } finally {
        requestInFlight = false;
      }
    };

    const pingWhenVisible = () => {
      if (document.visibilityState === "visible") ping();
    };

    ping();
    const interval = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", pingWhenVisible);
    window.addEventListener("focus", pingWhenVisible);
    window.addEventListener("online", pingWhenVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", pingWhenVisible);
      window.removeEventListener("focus", pingWhenVisible);
      window.removeEventListener("online", pingWhenVisible);
    };
  }, []);

  return null;
}