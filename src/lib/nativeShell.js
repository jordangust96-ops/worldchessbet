// Presentation only. Never use this signal for auth, cash eligibility or consent.
// Build 2.133921.5 includes ReactNativeWebView and Wix's hybrid bridge.
// Do not classify Safari, a home-screen PWA or an iPad's desktop UA as native.
export function isNativeShell(target = typeof window === "undefined" ? null : window) {
  return Boolean(
    typeof target?.ReactNativeWebView?.postMessage === "function" &&
    (target?.wixMobileNativeBridge || target?.__hybrid_bridge)
  );
}
