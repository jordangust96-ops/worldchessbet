// Shared loading surface: no network assets, timers, or changes to auth flow.
export default function LoadingScreen() {
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
