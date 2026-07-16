import React from "react";

// Read-only wallet + account snapshot for one player in the dispute, so an
// admin can immediately see whether their funds are still recoverable.
export default function PlayerWalletCard({ label, player }) {
  if (!player) {
    return (
      <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 text-xs text-white/30">
        {label}: not applicable to this case.
      </div>
    );
  }

  const onHold = player.accountState === "suspended" || player.accountState === "closed";
  const fmt = (n) => `$${(n || 0).toFixed(2)}`;

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 space-y-1.5">
      <p className="text-xs font-semibold text-white">{label}</p>
      <p className="text-[11px] text-white/40">{player.name}</p>
      <div className="grid grid-cols-2 gap-1.5 text-xs pt-1">
        <div><p className="text-white/30">Available</p><p className="text-white/80 font-semibold">{fmt(player.wallet?.available)}</p></div>
        <div><p className="text-white/30">Held</p><p className="text-white/80 font-semibold">{fmt(player.wallet?.held)}</p></div>
        <div><p className="text-white/30">Total</p><p className="text-white/80 font-semibold">{fmt(player.wallet?.total)}</p></div>
        <div><p className="text-white/30">Withdrawals</p><p className={onHold ? "text-red-400 font-semibold" : "text-emerald-400 font-semibold"}>{onHold ? "On Hold" : "Enabled"}</p></div>
      </div>
      <p className="text-[11px] text-white/30 pt-0.5">Account Status: <span className="text-white/60 capitalize">{player.accountState}</span></p>
    </div>
  );
}