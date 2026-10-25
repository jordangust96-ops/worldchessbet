import { createContext, useContext, useEffect, useMemo, useState } from "react";

const LaunchContext = createContext(null);

// This provider stays above the router, so changing pages or rechecking auth
// cannot restart the branded opening. A new document/app boot starts fresh.
export function LaunchProvider({ children }) {
  const [complete, setComplete] = useState(false);
  const value = useMemo(() => ({ complete, setComplete }), [complete]);
  return <LaunchContext.Provider value={value}>{children}</LaunchContext.Provider>;
}

// Mounted inside the resolved route Suspense boundary, never in its fallback.
export function AppReady() {
  const launch = useContext(LaunchContext);
  const setComplete = launch?.setComplete;
  useEffect(() => { setComplete?.(true); }, [setComplete]);
  return null;
}

export default function LoadingScreen() {
  const launch = useContext(LaunchContext);
  if (!launch || launch.complete) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0A0A0A]" role="status" aria-label="Loading page">
        <div aria-hidden="true" className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-[#C9A84C] motion-reduce:animate-none" />
      </div>
    );
  }
  return (
    <div className="chessbet-launch" role="status" aria-live="polite" aria-label="Loading ChessBet">
      <div className="chessbet-launch__brand" aria-hidden="true">
        <div className="chessbet-launch__halo" />
        <svg className="chessbet-launch__crown" viewBox="0 0 1024 1024" fill="none">
          <g stroke="currentColor" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round">
            <path d="M260 430 374 504 512 310 650 504 764 430 700 648H324Z" />
            <path d="M350 722H674" />
          </g>
        </svg>
        <div className="chessbet-launch__name">ChessBet</div>
        <div className="chessbet-launch__caption">YOUR NEXT MOVE AWAITS</div>
        <div className="chessbet-launch__activity"><span /></div>
      </div>
    </div>
  );
}
