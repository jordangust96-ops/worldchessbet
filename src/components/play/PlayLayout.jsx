import React, { useRef } from "react";
import { motion } from "framer-motion";
import { useSize } from "@/hooks/use-size";

export default function PlayLayout({ board, showMobileBoard, children }) {
  const boardAreaRef = useRef(null);
  const size = useSize(boardAreaRef);
  const boardSize = size?.width > 0 && size?.height > 0
    ? Math.floor(Math.min(size.width, size.height))
    : null;

  return (
    <div className="px-5 pt-4 lg:flex lg:flex-1 lg:min-h-0 lg:py-3">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 lg:min-h-0 lg:flex-row lg:items-stretch lg:gap-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          ref={boardAreaRef}
          className={`play-board-area ${showMobileBoard ? "w-full" : "hidden"} min-w-0 min-h-0 lg:flex lg:flex-[62_1_0%] lg:flex-col lg:items-center lg:justify-center`}
          style={boardSize ? /** @type {any} */ ({ "--desktop-board-size": `${boardSize}px` }) : undefined}
        >
          {board}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full min-w-0 lg:min-h-0 lg:flex-[38_1_0%] lg:overflow-y-auto lg:overscroll-contain"
          aria-label="Match panel"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
