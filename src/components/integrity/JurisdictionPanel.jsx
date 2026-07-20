import React from "react";
import moment from "moment";
import { Globe2 } from "lucide-react";

const STATUS_STYLES = {
  approved: "bg-green-500/10 text-green-400 border-green-500/20",
  blocked: "bg-red-500/10 text-red-400 border-red-500/20",
  unknown: "bg-white/10 text-white/50 border-white/10",
  verification_failed: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.unknown;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${style}`}>
      {(status || "unknown").replace("_", " ")}
    </span>
  );
}

// Admin-only jurisdiction panel — read-only summary of the current
// verification status plus the immutable verification history. No manual
// override control is offered here: jurisdiction status is only ever set by
// the getCurrentJurisdiction backend function, never by an administrator.
export default function JurisdictionPanel({ targetUser, logs }) {
  if (!targetUser) return null;

  const latestLog = logs && logs.length > 0 ? logs[0] : null;

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Globe2 size={15} className="text-[#C9A84C]" />
        <h2 className="text-sm font-bold text-white/80">Jurisdiction Verification</h2>
      </div>

      {latestLog && !latestLog.geolocation_enforcement_enabled && (
        <div className="mb-4 rounded-xl bg-yellow-500/5 border border-yellow-500/20 p-3">
          <p className="text-xs text-yellow-400/80">
            Geolocation enforcement is currently disabled platform-wide (pre-launch). This user's status reads
            "approved" regardless of location.
            {latestLog.enforcement_bypassed && (
              <> Most recent actual computed result: <strong className="uppercase">{latestLog.pre_bypass_verification_result}</strong>.</>
            )}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Current Jurisdiction</p>
          <p className="text-sm font-semibold text-white">
            {targetUser.current_jurisdiction_state || "—"}
            {targetUser.current_jurisdiction_country ? `, ${targetUser.current_jurisdiction_country}` : ""}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Verification Result</p>
          <StatusBadge status={targetUser.jurisdiction_status} />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Verification Timestamp</p>
          <p className="text-sm text-white/70">
            {targetUser.jurisdiction_last_verified_at
              ? moment(targetUser.jurisdiction_last_verified_at).format("MMM D, YYYY h:mm A")
              : "Never verified"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Verification Provider</p>
          <p className="text-sm text-white/70">{targetUser.jurisdiction_verification_provider || "—"}</p>
        </div>
      </div>

      {targetUser.jurisdiction_vpn_detected && (
        <p className="text-xs text-orange-400/80 mb-4">
          VPN, proxy, or anonymizing network detected on the most recent verification.
        </p>
      )}

      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Verification History</p>
      <div className="rounded-xl bg-white/[0.02] border border-white/5 divide-y divide-white/5 max-h-72 overflow-y-auto">
        {(!logs || logs.length === 0) ? (
          <p className="text-xs text-white/30 p-4">No verification events recorded yet.</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="p-3 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="text-white/70">
                  {log.detected_state || "—"}
                  {log.detected_country ? `, ${log.detected_country}` : ""}
                  {log.trigger_event ? ` · ${log.trigger_event}` : ""}
                </p>
                <p className="text-white/30">{moment(log.verified_at || log.created_date).format("MMM D, YYYY h:mm A")}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {log.vpn_or_proxy_detected && (
                  <span className="text-[9px] font-bold uppercase text-orange-400/80">VPN/Proxy</span>
                )}
                <StatusBadge status={log.verification_result} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}