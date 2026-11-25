import { Loader2 } from "lucide-react";

// The OS owns the cold-launch logo. Web auth, route and page-data checks all
// use this same viewport anchor, including after a full login redirect.
export default function LoadingScreen({ label = "Loading ChessBet" }) {
  return (
    <div className="chessbet-loading-screen" role="status" aria-live="polite" aria-label={label}>
      <Loader2 size={24} aria-hidden="true" className="animate-spin text-[#C9A84C] motion-reduce:animate-none" />
    </div>
  );
}

