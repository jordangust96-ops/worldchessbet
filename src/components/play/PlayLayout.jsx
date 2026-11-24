import React, { useRef } from "react";
import { motion } from "framer-motion";
import { useSize } from "@/hooks/use-size";

export default function PlayLayout({ board, showMobileBoard, children }) {
  const layoutRef = useRef(null);
  const size = useSize(layoutRef);
  const desktopSpace = size ? /** @type {any} */ ({
    "--play-layout-width": `${Math.floor(size.width)}px`,
    "--play-layout-height": `${Math.floor(size.height)}px`,
  }) : undefined;

  return (
    <div ref={layoutRef} style={desktopSpace} className="px-5 pt-4 lg:min-h-0 lg:flex-1 lg:py-3">
      <div
        className="play-layout-columns mx-auto flex w-full max-w-6xl flex-col gap-5"
        data-game-board={showMobileBoard ? "" : undefined}
      >
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
          className="play-match-area w-full min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"
          aria-label="Match panel"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
