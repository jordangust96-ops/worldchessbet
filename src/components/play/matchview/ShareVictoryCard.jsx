import React, { forwardRef } from "react";
import { Crown } from "lucide-react";
import { Chessboard } from "react-chessboard";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/40">{label}</span>
      <span className="font-bold text-white">{value}</span>
    </div>
  );
}

// Rendered off-screen and captured via html2canvas — never shown directly to the user.
const ShareVictoryCard = forwardRef(function ShareVictoryCard(
  { winnerName, opponentName, wagerAmount, timeControl, amountWon, endReason, fen },
  ref
) {
  return (
    <div ref={ref} style={{ width: 1200, height: 630 }} className="flex items-stretch gap-10 p-12 bg-[#0A0A0A]">
      <div className="flex items-center justify-center rounded-3xl bg-white/[0.04] border border-white/5 p-6" style={{ width: 550 }}>
        <Chessboard
          position={fen || START_FEN}
          boardWidth={470}
          arePiecesDraggable={false}
          customBoardStyle={{ borderRadius: "12px" }}
        />
      </div>
      <div className="flex-1 flex flex-col justify-center gap-7 text-white">
        <div className="flex items-center gap-3">
          <Crown className="text-[#C9A84C]" size={36} />
          <span className="text-3xl font-extrabold gold-text">ChessBet</span>
        </div>
        <div>
          <p className="text-6xl font-extrabold text-[#C9A84C]">Victory</p>
          <p className="text-xl text-white/40 mt-2">{endReason}</p>
        </div>
        <div className="space-y-3 text-2xl">
          <Row label="Winner" value={winnerName} />
          <Row label="Opponent" value={opponentName} />
          <Row label="Wager" value={`$${wagerAmount.toFixed(2)}`} />
          <Row label="Time Control" value={timeControl} />
        </div>
        <div className="rounded-2xl bg-[#C9A84C]/10 border border-[#C9A84C]/30 p-5">
          <p className="text-sm uppercase tracking-widest text-[#C9A84C]/70">Amount Won</p>
          <p className="text-5xl font-extrabold text-[#C9A84C]">${amountWon.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
});

export default ShareVictoryCard;