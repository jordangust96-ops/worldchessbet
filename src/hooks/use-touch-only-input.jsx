import * as React from "react";

const TOUCH_ONLY_QUERY = "(hover: none) and (pointer: coarse)";

function detectTouchOnlyInput() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(TOUCH_ONLY_QUERY).matches;
}

// Touch-first phones and tablets use Click to Move exclusively. This is
// intentionally device-scoped: a player's desktop Drag & Drop preference must
// not make the mobile board require dragging.
export function useTouchOnlyInput() {
  const [touchOnly, setTouchOnly] = React.useState(detectTouchOnlyInput);

  React.useEffect(() => {
    const media = window.matchMedia(TOUCH_ONLY_QUERY);
    const update = () => setTouchOnly(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return touchOnly;
}
