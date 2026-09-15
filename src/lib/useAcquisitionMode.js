import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { setPostAuthRedirect } from "@/lib/postAuthRedirect";

// Only explicit acquisition links replace a pending invitation destination.
export default function useAcquisitionMode() {
  const { search } = useLocation();
  const requested = new URLSearchParams(search).get("mode");
  const mode = requested === "free" || requested === "money" ? requested : "";
  useEffect(() => {
    if (mode) setPostAuthRedirect("/play?mode=" + mode);
  }, [mode]);
  return mode;
}
