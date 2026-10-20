// Device location supplements the server's jurisdiction evidence. A credible
// mismatch can veto approval; the server remains the authority for paid actions.
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

// Compatibility for previously cached imports. No device attributes are read,
// combined, hashed, or transmitted. Current callers no longer use this export.
export async function getDeviceFingerprintHash() { return ""; }
