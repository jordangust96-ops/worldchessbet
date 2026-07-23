import React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

// Never silently fails: always shows connector state, connected account, and
// property ID, plus the exact error/permission issue when something's wrong.
export default function ConnectorStatusBanner({ connector }) {
  if (!connector) return null;
  const hasError = !!connector.error;

  if (!hasError) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-green-500/5 border border-green-500/20 px-3 py-2 mb-6 text-xs text-green-400/80">
        <CheckCircle2 size={14} className="shrink-0" />
        <span>
          Connected to GA4 property {connector.propertyId} as {connector.accountEmail || "unknown account"}.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-red-500/5 border border-red-500/20 px-4 py-3 mb-6">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-red-400">Google Analytics data unavailable</p>
          <p className="text-xs text-red-400/70 leading-relaxed">{connector.error}</p>
          <p className="text-[11px] text-white/30">
            Connector: {connector.connected ? "Connected" : "Not connected"} · Account: {connector.accountEmail || "—"} · Property ID:{" "}
            {connector.propertyId || "not set"}
          </p>
        </div>
      </div>
    </div>
  );
}