import React, { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { Share2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import ShareVictoryCard from "./ShareVictoryCard";

// Only the winner's/opponent's usernames and public match details are ever
// rendered onto the card or included in the post text — no email, balance,
// or transaction history.
export default function ShareOnXButton({ match, game, winnerName, opponentName, endReason }) {
  const cardRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  const { toast } = useToast();

  const amountWon = match.wager_amount * 2 * 0.9;
  const postText = `♟️ I just won $${amountWon.toFixed(2)} on ChessBet.\n\n💰 Winnings: $${amountWon.toFixed(2)}\n♟️ Time Control: ${match.display_name}\n\nThink you can beat me?\n\n#ChessBet #Chess`;

  const handleShare = async () => {
    setSharing(true);
    try {
      const canvas = await html2canvas(cardRef.current, { backgroundColor: "#0A0A0A", scale: 2 });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "chessbet-victory.png", { type: "image/png" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: postText, title: "ChessBet Victory" });
        } catch (e) {
          // User cancelled the native share sheet — nothing to do.
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "chessbet-victory.png";
        a.click();
        URL.revokeObjectURL(url);
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(postText)}`, "_blank");
        toast({
          title: "Victory card downloaded",
          description: "Attach the downloaded image to your post on X.",
        });
      }
    } finally {
      setSharing(false);
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
        onClick={handleShare}
        disabled={sharing}
        variant="outline"
        className="w-full h-12 rounded-2xl border-[#C9A84C]/30 text-[#C9A84C] font-bold hover:bg-[#C9A84C]/10"
      >
        {sharing ? <Loader2 className="animate-spin mr-2" size={16} /> : <Share2 size={16} className="mr-2" />}
        Share on X
      </Button>
    </>
  );
}