// A live check of the Google Maps key from this browser and this site
// address, the way the map and the geocoder will use it:
// - the Maps JavaScript API: Google reports key problems only through
//   window.gm_authFailure and a console error naming the cause
//   (e.g. "RefererNotAllowedMapError"), so both are watched briefly;
// - the Geocoding API: a real lookup, whose response says why it's refused.
import type { MapsCheck } from "../domain/integrationHealth";
import { loadGoogleMapsScript } from "./googleMaps";

declare global {
  interface Window { gm_authFailure?: () => void }
}

const AUTH_WAIT_MS = 3000;

async function checkMapScript(apiKey: string): Promise<MapsCheck["map"]> {
  let code = "";
  let failed = false;
  const prevAuth = window.gm_authFailure;
  const prevError = console.error;
  window.gm_authFailure = () => { failed = true; };
  console.error = (...args: unknown[]) => {
    const m = /Google Maps JavaScript API error: (\w+)/.exec(args.map(String).join(" "));
    if (m) { code = m[1]; failed = true; }
    prevError(...args);
  };
  try {
    await loadGoogleMapsScript(apiKey);
    // Key checks run when a map is created; a hidden one is enough.
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;width:10px;height:10px;left:-9999px;top:0";
    document.body.appendChild(el);
    try {
      new window.google.maps.Map(el, { center: { lat: 33.75, lng: -84.39 }, zoom: 10 });
      await new Promise(r => setTimeout(r, AUTH_WAIT_MS));
    } finally {
      el.remove();
    }
    return failed ? { ok: false, code: code || "AuthFailure" } : { ok: true };
  } catch {
    return { ok: false, code: code || "ScriptLoadError" };
  } finally {
    window.gm_authFailure = prevAuth;
    console.error = prevError;
  }
}

async function checkGeocode(apiKey: string): Promise<MapsCheck["geocode"]> {
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent("Atlanta, GA")}&key=${encodeURIComponent(apiKey)}`);
    const data = await res.json().catch(() => ({}));
    if (data.status === "OK") return { ok: true, status: "OK" };
    return { ok: false, status: data.status || `HTTP ${res.status}`, message: data.error_message || "" };
  } catch (err) {
    return { ok: false, status: "NETWORK", message: err instanceof Error ? err.message : "" };
  }
}

export async function checkGoogleMaps(apiKey: string): Promise<MapsCheck> {
  const [map, geocode] = await Promise.all([checkMapScript(apiKey), checkGeocode(apiKey)]);
  return { map, geocode };
}
