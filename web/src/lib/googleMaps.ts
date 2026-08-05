// Ported verbatim from app.js (loadGoogleMaps) — same module-level caching by
// API key so the script tag is only injected once per key.
declare global {
  interface Window { google?: any; [key: string]: any }
}

const mapsRuntime: { key: string; promise: Promise<any> | null } = { key: "", promise: null };

export function loadGoogleMaps(key: string): Promise<any> {
  if (window.google?.maps && mapsRuntime.key === key) return Promise.resolve(window.google.maps);
  if (mapsRuntime.promise && mapsRuntime.key === key) return mapsRuntime.promise;
  mapsRuntime.key = key;
  mapsRuntime.promise = new Promise((resolve, reject) => {
    const callback = "fialhoGoogleMapsReady_" + Date.now();
    window[callback] = () => {
      delete window[callback];
      resolve(window.google.maps);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
  return mapsRuntime.promise;
}
