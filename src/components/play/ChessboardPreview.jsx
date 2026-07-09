import React, { useRef } from "react";
import { motion } from "framer-motion";
import { Chessboard } from "react-chessboard";
import { useSize } from "@/hooks/use-size";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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
  game_summary: {
    wrapperAnimate: { scale: 1, opacity: 1 },
    wrapperTransition: { duration: 1.2, ease: "easeInOut" },
    glow: "0 0 0 rgba(201,168,76,0)",
    borderColor: "rgba(201,168,76,0.2)",
    filter: "brightness(1) contrast(1)",
    breathe: false,
    sweep: false,
    vignette: false,
  },
};

export default function ChessboardPreview({
  state = "marketplace",
  fen,
  onPieceDrop,
  boardOrientation = "white",
  arePiecesDraggable = false,
}) {
  const style = STATE_STYLES[state] || STATE_STYLES.marketplace;
  const containerRef = useRef(null);
  const size = useSize(containerRef);

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

      <div ref={containerRef} className="w-full h-full relative">
        {size?.width ? (
          <Chessboard
            position={fen || START_FEN}
            onPieceDrop={onPieceDrop}
            boardOrientation={boardOrientation}
            arePiecesDraggable={arePiecesDraggable}
            boardWidth={Math.min(size.width, size.height || size.width)}
            customDarkSquareStyle={{ backgroundColor: "#171310" }}
            customLightSquareStyle={{ backgroundColor: "#2A231A" }}
            customBoardStyle={{ borderRadius: "0px" }}
            animationDuration={200}
          />
        ) : null}
      </div>
    </motion.div>
  );
}