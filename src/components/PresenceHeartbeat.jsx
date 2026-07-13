import { useEffect } from "react";
import { base44 } from "@/api/base44Client";

const HEARTBEAT_INTERVAL_MS = 20 * 1000;

// Stamps the current user's last_active_at while ChessBet is open, so backend
// notification logic can reliably tell whether a user is genuinely away
// instead of relying on component mount/unmount timing.
export default function PresenceHeartbeat() {
  useEffect(() => {
    const ping = () => {
      base44.auth.updateMe({ last_active_at: new Date().toISOString() });
    };
    ping();
    const interval = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
}