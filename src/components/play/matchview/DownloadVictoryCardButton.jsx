import React, { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ShareVictoryCard from "./ShareVictoryCard";

// Only the winner's/opponent's usernames and public match details are ever
// rendered onto the card — no email, balance, or transaction history.
export default function DownloadVictoryCardButton({ match, game, winnerName, opponentName, endReason }) {
  const cardRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  const amountWon = match.wager_amount * 2;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const canvas = await html2canvas(cardRef.current, { backgroundColor: "#0A0A0A", scale: 2 });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "chessbet-victory.png";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div style={{ position: "fixed", top: 0, left: "-9999px", pointerEvents: "none" }} aria-hidden>
        <ShareVictoryCard
          ref={cardRef}
          winnerName={winnerName}
          opponentName={opponentName}
          wagerAmount={match.wager_amount}
          timeControl={match.display_name}
          amountWon={amountWon}
          endReason={endReason}
          fen={game?.fen}
        />
      </div>
      <Button
        onClick={handleDownload}
        disabled={downloading}
        variant="ghost"
        className="w-full h-10 rounded-2xl text-white/40 font-semibold hover:bg-white/5 hover:text-white/60"
      >
        {downloading ? <Loader2 className="animate-spin mr-2" size={14} /> : <Download size={14} className="mr-2" />}
        Download Victory Card
      </Button>
    </>
  );
}