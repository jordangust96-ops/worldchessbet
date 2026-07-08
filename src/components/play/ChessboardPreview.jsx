import React from "react";

const PIECES = {
  0: { 0: "♜", 1: "♞", 2: "♝", 3: "♛", 4: "♚", 5: "♝", 6: "♞", 7: "♜" },
  1: { 0: "♟", 1: "♟", 2: "♟", 3: "♟", 4: "♟", 5: "♟", 6: "♟", 7: "♟" },
  6: { 0: "♙", 1: "♙", 2: "♙", 3: "♙", 4: "♙", 5: "♙", 6: "♙", 7: "♙" },
  7: { 0: "♖", 1: "♘", 2: "♗", 3: "♕", 4: "♔", 5: "♗", 6: "♘", 7: "♖" },
};

export default function ChessboardPreview() {
  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const isDark = (row + col) % 2 === 1;
      const piece = PIECES[row]?.[col];
      squares.push(
        <div
          key={`${row}-${col}`}
          className={`aspect-square flex items-center justify-center ${
            isDark ? "bg-[#171310]" : "bg-[#2A231A]"
          }`}
        >
          {piece && (
            <span
              className={`text-[clamp(16px,5vw,42px)] leading-none select-none ${
                row < 2 ? "text-[#8A8A8A]" : "text-[#C9A84C]"
              }`}
              style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
            >
              {piece}
            </span>
          )}
        </div>
      );
    }
  }

  return (
    <div className="w-full lg:w-auto lg:h-full lg:aspect-square rounded-3xl overflow-hidden border border-[#C9A84C]/20 shadow-2xl shadow-black/50">
      <div className="grid grid-cols-8 w-full h-full">{squares}</div>
    </div>
  );
}