import { useEffect, useState } from "react";
import { isNativeShell } from "./nativeShell";

// Usually injected before React starts. Recheck briefly for a late bridge,
// without storing a flag or changing the URL, session or security settings.
export default function useNativeShell() {
  const [native, setNative] = useState(isNativeShell);
  useEffect(() => {
    if (native) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (isNativeShell()) {
        setNative(true);
        window.clearInterval(timer);
      } else if (++attempts >= 20) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [native]);
  return native;
}
