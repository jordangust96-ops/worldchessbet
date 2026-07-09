import React, { useRef } from "react";
import { motion } from "framer-motion";
import { Chessboard } from "react-chessboard";
import { useSize } from "@/hooks/use-size";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Board surface colors — marketplace stays quiet/dark, active states get a brighter, illuminated surface.
const MARKETPLACE_SQUARES = { dark: "#171310", light: "#2A231A" };
const ACTIVE_SQUARES = { dark: "#241C15", light: "#3A3021" };

// Visual "energy level" per match state — the board comes alive as the match progresses.
// Note: brightness is expressed via `ambientOpacity` (an overlay blend, not a CSS
// `filter`). A CSS `filter`/`transform` on this wrapper would create a new containing
// block for any `position: fixed` descendants — including react-chessboard's dragged
// piece layer — which is what previously caused the piece to visibly drift away from
// the cursor while dragging.
const STATE_STYLES = {
  marketplace: {
    wrapperAnimate: { opacity: 1 },
    wrapperTransition: { duration: 0.8, ease: "easeOut" },
    glow: "0 0 0 rgba(201,168,76,0)",
    borderColor: "rgba(201,168,76,0.2)",
    ambientOpacity: 0,
    breathe: false,
    sweep: false,
    vignette: false,
    squares: MARKETPLACE_SQUARES,
    ambient: false,
  },
  accepted: {
    wrapperAnimate: { opacity: 1 },
    wrapperTransition: { duration: 1, ease: "easeOut" },
    glow: "0 0 30px rgba(201,168,76,0.18)",
    borderColor: "rgba(201,168,76,0.35)",
    ambientOpacity: 0.55,
    breathe: false,
    sweep: false,
    vignette: false,
    squares: ACTIVE_SQUARES,
    ambient: true,
  },
  deposit_waiting: {
    wrapperAnimate: { opacity: 1 },
    wrapperTransition: { duration: 1, ease: "easeOut" },
    glow: "0 0 30px rgba(201,168,76,0.18)",
    borderColor: "rgba(201,168,76,0.35)",
    ambientOpacity: 0.55,
    breathe: true,
    sweep: false,
    vignette: false,
    squares: ACTIVE_SQUARES,
    ambient: true,
  },
  both_ready: {
    wrapperAnimate: { opacity: 1 },
    wrapperTransition: { duration: 0.8, ease: "easeOut" },
    glow: "0 0 45px rgba(201,168,76,0.3)",
    borderColor: "rgba(201,168,76,0.6)",
    ambientOpacity: 0.75,
    breathe: false,
    sweep: true,
    vignette: true,
    squares: ACTIVE_SQUARES,
    ambient: true,
  },
  in_progress: {
    wrapperAnimate: { opacity: 1 },
    wrapperTransition: { duration: 0.8, ease: "easeOut" },
    glow: "0 0 60px rgba(201,168,76,0.45)",
    borderColor: "rgba(201,168,76,0.9)",
    ambientOpacity: 1,
    breathe: false,
    sweep: true,
    vignette: true,
    squares: ACTIVE_SQUARES,
    ambient: true,
  },
  settlement: {
    wrapperAnimate: { opacity: 1 },
    wrapperTransition: { duration: 1.6, ease: "easeInOut" },
    glow: "0 0 0 rgba(201,168,76,0)",
    borderColor: "rgba(201,168,76,0.2)",
    ambientOpacity: 0,
    breathe: false,
    sweep: false,
    vignette: false,
    squares: MARKETPLACE_SQUARES,
    ambient: false,
  },
  game_summary: {
    wrapperAnimate: { opacity: 1 },
    wrapperTransition: { duration: 1.2, ease: "easeInOut" },
    glow: "0 0 0 rgba(201,168,76,0)",
    borderColor: "rgba(201,168,76,0.2)",
    ambientOpacity: 0,
    breathe: false,
    sweep: false,
    vignette: false,
    squares: MARKETPLACE_SQUARES,
    ambient: false,
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

      {style.ambient && (
        <div
          className="absolute inset-0 pointer-events-none rounded-3xl"
          style={{
            background:
              "radial-gradient(circle at 50% 45%, rgba(255,241,204,0.16), rgba(255,241,204,0.04) 55%, transparent 75%)",
            mixBlendMode: "soft-light",
            opacity: style.ambientOpacity,
          }}
        />
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
            customDarkSquareStyle={{ backgroundColor: style.squares.dark }}
            customLightSquareStyle={{ backgroundColor: style.squares.light }}
            customBoardStyle={{ borderRadius: "0px" }}
            animationDuration={200}
          />
        ) : null}
      </div>
    </motion.div>
  );
}