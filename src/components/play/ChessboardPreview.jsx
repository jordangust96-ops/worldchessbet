import React from "react";
import { motion } from "framer-motion";

const PIECES = {
  0: { 0: "♜", 1: "♞", 2: "♝", 3: "♛", 4: "♚", 5: "♝", 6: "♞", 7: "♜" },
  1: { 0: "♟", 1: "♟", 2: "♟", 3: "♟", 4: "♟", 5: "♟", 6: "♟", 7: "♟" },
  6: { 0: "♙", 1: "♙", 2: "♙", 3: "♙", 4: "♙", 5: "♙", 6: "♙", 7: "♙" },
  7: { 0: "♖", 1: "♘", 2: "♗", 3: "♕", 4: "♔", 5: "♗", 6: "♘", 7: "♖" },
};

// Visual "energy level" per match state — the board comes alive as the match progresses.
const STATE_STYLES = {
  marketplace: {
    wrapperAnimate: { scale: 1, opacity: 1 },
    wrapperTransition: { duration: 0.8, ease: "easeOut" },
    glow: "0 0 0 rgba(201,168,76,0)",
    borderColor: "rgba(201,168,76,0.2)",
    filter: "brightness(1) contrast(1)",
    breathe: false,
    sweep: false,
    vignette: false,
  },
  accepted: {
    wrapperAnimate: { scale: 1, opacity: 1 },
    wrapperTransition: { duration: 1, ease: "easeOut" },
    glow: "0 0 30px rgba(201,168,76,0.18)",
    borderColor: "rgba(201,168,76,0.35)",
    filter: "brightness(1.05) contrast(1.05)",
    breathe: false,
    sweep: false,
    vignette: false,
  },
  deposit_waiting: {
    wrapperAnimate: { scale: 1, opacity: 1 },
    wrapperTransition: { duration: 1, ease: "easeOut" },
    glow: "0 0 30px rgba(201,168,76,0.18)",
    borderColor: "rgba(201,168,76,0.35)",
    filter: "brightness(1.05) contrast(1.05)",
    breathe: true,
    sweep: false,
    vignette: false,
  },
  both_ready: {
    wrapperAnimate: { scale: 1, opacity: 1 },
    wrapperTransition: { duration: 0.8, ease: "easeOut" },
    glow: "0 0 45px rgba(201,168,76,0.3)",
    borderColor: "rgba(201,168,76,0.6)",
    filter: "brightness(1.1) contrast(1.08)",
    breathe: false,
    sweep: true,
    vignette: true,
  },
  in_progress: {
    wrapperAnimate: { scale: 1, opacity: 1 },
    wrapperTransition: { duration: 0.8, ease: "easeOut" },
    glow: "0 0 60px rgba(201,168,76,0.45)",
    borderColor: "rgba(201,168,76,0.9)",
    filter: "brightness(1.18) contrast(1.15)",
    breathe: false,
    sweep: true,
    vignette: true,
  },
  settlement: {
    wrapperAnimate: { scale: 1, opacity: 1 },
    wrapperTransition: { duration: 1.6, ease: "easeInOut" },
    glow: "0 0 0 rgba(201,168,76,0)",
    borderColor: "rgba(201,168,76,0.2)",
    filter: "brightness(1) contrast(1)",
    breathe: false,
    sweep: false,
    vignette: false,
  },
};

export default function ChessboardPreview({ state = "marketplace" }) {
  const style = STATE_STYLES[state] || STATE_STYLES.marketplace;

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
    <motion.div
      animate={{
        ...style.wrapperAnimate,
        boxShadow: style.glow,
        borderColor: style.borderColor,
        filter: style.filter,
      }}
      transition={style.wrapperTransition}
      className="relative w-full lg:w-auto lg:h-full lg:aspect-square rounded-3xl overflow-hidden border shadow-2xl shadow-black/50"
    >
      {style.breathe && (
        <motion.div
          className="absolute inset-0 pointer-events-none rounded-3xl"
          style={{ boxShadow: "0 0 40px rgba(201,168,76,0.25)" }}
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {style.sweep && (
        <motion.div
          className="absolute inset-0 pointer-events-none rounded-3xl overflow-hidden"
          aria-hidden
        >
          <motion.div
            className="absolute top-0 bottom-0 w-1/3"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(201,168,76,0.25), transparent)",
            }}
            animate={{ left: ["-40%", "110%"] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      )}

      {style.vignette && (
        <div
          className="absolute inset-0 pointer-events-none rounded-3xl"
          style={{
            boxShadow: "inset 0 0 60px rgba(0,0,0,0.45)",
          }}
        />
      )}

      <div className="grid grid-cols-8 w-full h-full relative">{squares}</div>
    </motion.div>
  );
}