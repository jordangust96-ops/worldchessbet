export const privacy = () => window.ChessBetPrivacy;
export const canTrack = category => typeof window !== "undefined" && window.ChessBetPrivacy?.allowed(category) === true;
export const openCookieSettings = () => window.dispatchEvent(new Event("chessbet:open-privacy"));
export function safePage() {
  return { page_location: window.location.origin + window.location.pathname, page_path: window.location.pathname, page_title: document.title, page_referrer: "" };
}
