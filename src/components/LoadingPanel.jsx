// Preserve a panel's space while its content arrives. No extra spinner at a
// different screen position, and no fabricated balances, players or contests.
export default function LoadingPanel({ label = "Loading", compact = false }) {
  return (
    <div role="status" aria-label={label} className={compact ? "w-full space-y-3 py-5" : "w-full space-y-4 py-8"}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="h-3 w-2/5 rounded-full bg-white/[0.07]" />
      <div aria-hidden="true" className="h-3 w-4/5 rounded-full bg-white/[0.04]" />
      <div aria-hidden="true" className="h-12 w-full rounded-xl border border-white/[0.05] bg-white/[0.02]" />
    </div>
  );
}
