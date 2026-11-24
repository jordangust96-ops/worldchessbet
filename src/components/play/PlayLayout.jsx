import React from "react";
import { motion } from "framer-motion";

export default function PlayLayout({ board, showMobileBoard, children }) {
  return (
    <div className="play-layout px-5 pt-4 lg:min-h-0 lg:flex-1 lg:py-3">
      <div className="play-layout-columns mx-auto flex w-full max-w-6xl flex-col gap-5">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`play-board-area ${showMobileBoard ? "w-full" : "hidden"} min-w-0 min-h-0 lg:flex lg:flex-col lg:items-center lg:justify-center`}
        >
          {board}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"
          aria-label="Match panel"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
