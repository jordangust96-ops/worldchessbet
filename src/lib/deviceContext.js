// Secondary, non-authoritative forensic signals collected only immediately
// before a paid action (deposit or contest entry reservation). Neither
// signal ever gates or blocks the user client-side — the server-side
// MaxMind jurisdiction check remains the sole authority. These are purely
// logged for administrative/fraud-investigation purposes.

// Requests the browser's HTML5 Geolocation API. Resolves quickly with a
// descriptive permission state rather than throwing, so callers can always
// safely proceed with their paid action regardless of the outcome.
export function getBrowserGeolocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ permission: "unavailable" });
      return;
    }
    const timeout = setTimeout(() => resolve({ permission: "unavailable" }), 4000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timeout);
        resolve({
          permission: "granted",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timeout);
        resolve({ permission: "denied" });
      },
      { timeout: 4000, maximumAge: 60000 }
    );
  });
}

// Builds a lightweight, non-invasive device fingerprint from ordinary
// browser characteristics (never canvas/audio fingerprinting) and returns a
// SHA-256 hex hash. Used only for fraud investigation — never to block users.
export async function getDeviceFingerprintHash() {
  try {
    const parts = [
      navigator.userAgent || "",
      navigator.platform || "",
      navigator.language || "",
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      `${window.screen?.width || ""}x${window.screen?.height || ""}`,
      String(window.screen?.colorDepth || ""),
      String(window.devicePixelRatio || ""),
    ];
    const encoder = new TextEncoder();
    const data = encoder.encode(parts.join("|"));
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}