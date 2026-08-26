// Same 25-record cap per click, same "table = kind" dispatch to whichever
// entity the map pin represents. Swapped from Nominatim (OpenStreetMap) to
// Google's Geocoding REST API at the user's request — needs an API key
// (integration_settings.google_maps.api_key) but no more 1 req/sec throttle,
// so callers pass the key straight through instead of the app rate-limiting
// itself. findCachedCoordinate() still reuses a coordinate already saved on
// another record at the same address, and RecordModal still auto-geocodes
// one address at a time on save, both worth keeping since they cut billed
// API calls regardless of provider.
import { normAddress, normZip } from "../domain/format";
import type { MapKind } from "../domain/types";
import { supabase } from "../lib/supabaseClient";
import { updateCustomer } from "./customers";
import { updateJob } from "./jobs";
import { updateLead } from "./leads";

export async function updateRecordLatLng(kind: MapKind, id: string, companyId: string, lat: number, lng: number) {
  if (kind === "job") return updateJob(id, companyId, { lat, lng });
  if (kind === "lead") return updateLead(id, companyId, { lat, lng });
  return updateCustomer(id, companyId, { lat, lng });
}

// Frontend-side cache, keyed by the normalized full-address string, on top of
// findCachedCoordinate()'s DB lookup below. Catches two things the DB check
// can't: repeat lookups for an address that hasn't been saved to a record
// yet (e.g. the same not-quite-matching address turning up twice in one
// bulk import), and — since it's checked first — skips even the DB
// round-trip on a hit. Persisted to localStorage so it survives a reload,
// with an in-memory Map on top so repeated lookups in the same tick don't
// re-parse JSON every time. A `null` entry (looked up, no match found) is
// cached too, so a bad address doesn't get retried against Google forever
// within the session (and doesn't burn another billed call).
const GEOCODE_CACHE_KEY = "fialho_geocode_cache";
type CachedCoord = { lat: number; lng: number } | null;
let geocodeCache: Map<string, CachedCoord> | null = null;

// `companyId` is folded into the key (2026-08-26 security fix) so this
// browser-wide localStorage cache can't serve one company's resolved
// coordinates for a same-address lookup under a different company on a
// shared browser, and so a fully unauthenticated viewer (e.g. at the login
// screen) reading the raw cache can't learn anything at all without also
// already knowing an internal company_id.
function normalizeAddressKey(companyId: string, ...parts: (string | undefined)[]): string {
  return [companyId, ...parts.filter(Boolean)].join(",").toLowerCase().replace(/\s+/g, " ").trim();
}

function loadGeocodeCache(): Map<string, CachedCoord> {
  if (geocodeCache) return geocodeCache;
  try {
    const raw = localStorage.getItem(GEOCODE_CACHE_KEY);
    geocodeCache = new Map(raw ? Object.entries(JSON.parse(raw)) : []);
  } catch {
    geocodeCache = new Map();
  }
  return geocodeCache;
}

function rememberGeocodeResult(key: string, value: CachedCoord) {
  const cache = loadGeocodeCache();
  cache.set(key, value);
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // localStorage full/unavailable (private browsing, quota) — the
    // in-memory Map still serves cache hits for the rest of this session.
  }
}

async function googleGeocode(query: string, apiKey: string): Promise<{ lat: string; lon: string } | null> {
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) {
    console.error(`[geocoding] Google Geocoding HTTP ${res.status} for "${query}"`);
    return null;
  }
  const data = await res.json();
  if (data.status === "REQUEST_DENIED") {
    console.error(`[geocoding] Google Geocoding request denied: ${data.error_message || "check API key/enabled APIs"}`);
    return null;
  }
  const loc = data?.results?.[0]?.geometry?.location;
  if (!loc) {
    console.warn(`[geocoding] No Google match for "${query}" (status: ${data.status})`);
    return null;
  }
  return { lat: String(loc.lat), lon: String(loc.lng) };
}

// Looks for an already-geocoded row (any of the 3 tables) at the same
// address in this company, so a second job/lead at a repeat client's address
// doesn't cost another Google Geocoding call. Narrowed server-side by
// company_id + exact ZIP match first (cheap), then confirmed client-side by
// normalized address, since raw address text can differ in casing/punctuation.
export async function findCachedCoordinate(
  companyId: string,
  address: string,
  zip: string
): Promise<{ lat: number; lng: number } | null> {
  const targetAddress = normAddress(address);
  const targetZip = normZip(zip);
  if (!targetAddress || !targetZip) return null;

  for (const table of ["customers", "leads", "jobs"] as const) {
    const { data, error } = await supabase
      .from(table)
      .select("address, zip, lat, lng")
      .eq("company_id", companyId)
      .eq("zip", zip)
      .not("lat", "is", null)
      .not("lng", "is", null)
      .limit(10);
    if (error || !data) continue;
    const match = data.find(row => normAddress(row.address) === targetAddress && normZip(row.zip) === targetZip);
    if (match && match.lat != null && match.lng != null) {
      return { lat: Number(match.lat), lng: Number(match.lng) };
    }
  }
  return null;
}

// Single-address geocode used for auto-geocoding a record right when it's
// saved (RecordModal), as opposed to geocodeRecords()'s bulk "catch up on
// everything visible" pass from the Map & Routes page. `apiKey` comes from
// integration_settings.google_maps.api_key — callers should skip calling this
// at all when it's blank rather than let it fail.
export async function geocodeAddress(
  companyId: string,
  address: string,
  city: string,
  state: string,
  zip: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
  if (!fullAddress || !apiKey) return null;

  const cacheKey = normalizeAddressKey(companyId, address, city, state, zip);
  const localHit = loadGeocodeCache().get(cacheKey);
  if (localHit !== undefined) return localHit;

  const cached = await findCachedCoordinate(companyId, address, zip);
  if (cached) {
    rememberGeocodeResult(cacheKey, cached);
    return cached;
  }

  try {
    let loc = await googleGeocode(fullAddress, apiKey);
    if (!loc) {
      const areaOnly = [city, state, zip].filter(Boolean).join(", ");
      if (areaOnly && areaOnly !== fullAddress) loc = await googleGeocode(areaOnly, apiKey);
    }
    const result = loc ? { lat: Number(loc.lat), lng: Number(loc.lon) } : null;
    rememberGeocodeResult(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`[geocoding] Failed for "${fullAddress}":`, error);
    return null;
  }
}

export async function geocodeRecords(
  records: { kind: MapKind; id: string; address?: string; city?: string; state?: string; zip?: string }[],
  companyId: string,
  apiKey: string
): Promise<number> {
  if (!apiKey) return 0;
  let updated = 0;
  for (const record of records.slice(0, 25)) {
    const fullAddress = [record.address, record.city, record.state, record.zip].filter(Boolean).join(", ");
    if (!fullAddress) continue;
    const cacheKey = normalizeAddressKey(companyId, record.address, record.city, record.state, record.zip);
    try {
      const localHit = loadGeocodeCache().get(cacheKey);
      let loc: { lat: number; lng: number } | null;
      if (localHit !== undefined) {
        // Local cache already has an answer (coordinates, or a remembered
        // "no match") for this exact address — skip the DB check and any
        // network call entirely.
        loc = localHit;
      } else {
        loc = await findCachedCoordinate(companyId, record.address || "", record.zip || "");
        if (!loc) {
          let result = await googleGeocode(fullAddress, apiKey);
          if (!result) {
            const areaOnly = [record.city, record.state, record.zip].filter(Boolean).join(", ");
            if (areaOnly && areaOnly !== fullAddress) result = await googleGeocode(areaOnly, apiKey);
          }
          loc = result ? { lat: Number(result.lat), lng: Number(result.lon) } : null;
        }
        rememberGeocodeResult(cacheKey, loc);
      }
      if (loc) {
        await updateRecordLatLng(record.kind, record.id, companyId, loc.lat, loc.lng);
        updated++;
      }
    } catch (error) {
      console.error(`[geocoding] Failed for "${fullAddress}":`, error);
    }
  }
  return updated;
}
