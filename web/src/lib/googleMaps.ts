// Script-injector for the Google Maps JavaScript API, same cached-promise
// pattern as loadGoogleIdentity() in lib/googleOAuth.ts. Only the interactive
// <Map> component needs this (there's no way to render a pannable/zoomable
// map without the JS SDK) — geocoding and directions stay plain REST fetch
// calls (see data/geocoding.ts, data/routing.ts) so they work from any page,
// not just while the map is mounted.
declare global {
  interface Window { google?: any; __googleMapsCallback?: () => void }
}

let loadPromise: Promise<void> | null = null;
let loadedForKey = "";

export function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (!apiKey) return Promise.reject(new Error("No Google Maps API key configured."));
  if (window.google?.maps && loadedForKey === apiKey) return Promise.resolve();
  if (loadPromise && loadedForKey === apiKey) return loadPromise;

  loadedForKey = apiKey;
  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-google-maps]");
    if (existing) existing.remove();
    const script = document.createElement("script");
    const callbackName = "__googleMapsCallback";
    window[callbackName] = () => resolve();
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=marker&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";
    script.onerror = () => reject(new Error("Could not load Google Maps."));
    document.head.appendChild(script);
  });
  return loadPromise;
}
