// A live check of the Google Maps key from this browser and this site
// address, the way the map and the geocoder will use it:
// - the Maps JavaScript API: Google reports key problems only through
//   window.gm_authFailure and a console error naming the cause
//   (e.g. "RefererNotAllowedMapError"), so both are watched briefly;
// - the Geocoding API: a real lookup through the same Geocoder the app uses.
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

// Same path the app uses (data/geocoding.ts): the Maps JavaScript Geocoder.
async function checkGeocode(apiKey: string): Promise<MapsCheck["geocode"]> {
  try {
    await loadGoogleMapsScript(apiKey);
    const { results } = await new window.google.maps.Geocoder().geocode({ address: "Atlanta, GA" });
    return results?.length ? { ok: true, status: "OK" } : { ok: false, status: "ZERO_RESULTS", message: "" };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { ok: false, status: e?.code || "ERROR", message: e?.message || "" };
  }
}

export async function checkGoogleMaps(apiKey: string): Promise<MapsCheck> {
  const map = await checkMapScript(apiKey);
  // Without the map script there's no Geocoder to try.
  const geocode = map.ok ? await checkGeocode(apiKey) : { ok: true };
  return { map, geocode };
}
