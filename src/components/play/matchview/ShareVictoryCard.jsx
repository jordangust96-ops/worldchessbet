import React, { forwardRef } from "react";
import { Crown } from "lucide-react";
import { Chessboard } from "react-chessboard";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

// Rendered off-screen and captured via html2canvas — never shown directly to the user.
// Two-column social graphic: board on the left, amount won as the dominant focal point on the right.
const ShareVictoryCard = forwardRef(function ShareVictoryCard(
  { winnerName, opponentName, wagerAmount, timeControl, amountWon, endReason, fen },
  ref
) {
  return (
    <div ref={ref} style={{ width: 1200, height: 675 }} className="flex bg-[#0A0A0A] p-16 gap-14">
      <div className="w-[440px] flex items-center justify-center shrink-0">
        <div className="rounded-3xl bg-white/[0.03] border border-[#C9A84C]/30 shadow-[0_0_60px_rgba(201,168,76,0.15)] p-6">
          <Chessboard
            position={fen || START_FEN}
            boardWidth={400}
            arePiecesDraggable={false}
            customBoardStyle={{ borderRadius: "10px" }}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-2.5 mb-8">
          <Crown size={28} strokeWidth={1.5} className="text-[#C9A84C]" />
          <span className="text-2xl font-bold tracking-tight text-white">ChessBet</span>
        </div>

        <p className="text-2xl font-extrabold text-white/50 uppercase tracking-[0.3em] mb-2">Victory</p>
        <p className="text-[128px] leading-none font-extrabold text-[#C9A84C] mb-10">${amountWon.toFixed(2)}</p>

        <div className="grid grid-cols-2 gap-y-6 gap-x-10">
          <Stat label="Opponent" value={opponentName} />
          <Stat label="Won By" value={endReason} />
          <Stat label="Time Control" value={timeControl} />
          <Stat label="Wager" value={`$${wagerAmount.toFixed(2)}`} />
        </div>
      </div>
    </div>
  );
});

export default ShareVictoryCard;