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
// Amount won is the visual focal point; board, win method, wager, and branding are secondary.
const ShareVictoryCard = forwardRef(function ShareVictoryCard(
  { winnerName, opponentName, wagerAmount, timeControl, amountWon, endReason, fen },
  ref
) {
  return (
    <div ref={ref} style={{ width: 1200, height: 630 }} className="flex flex-col p-10 bg-[#0A0A0A]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Crown className="text-[#C9A84C]" size={26} />
          <span className="text-xl font-extrabold gold-text">ChessBet</span>
        </div>
        <span className="text-sm font-semibold text-white/40 uppercase tracking-widest">{winnerName} won</span>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-bold text-[#C9A84C]/70 uppercase tracking-widest">Amount Won</p>
          <p className="text-[160px] leading-none font-extrabold text-[#C9A84C] my-2">${amountWon.toFixed(2)}</p>
          <p className="text-2xl text-white/50">vs {opponentName}</p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-3">
          <Chessboard
            position={fen || START_FEN}
            boardWidth={140}
            arePiecesDraggable={false}
            customBoardStyle={{ borderRadius: "8px" }}
          />
        </div>
        <div className="flex-1 space-y-2 text-lg">
          <Row label="Won By" value={endReason} />
          <Row label="Wager" value={`$${wagerAmount.toFixed(2)}`} />
          <Row label="Time Control" value={timeControl} />
        </div>
      </div>
    </div>
  );
});

export default ShareVictoryCard;