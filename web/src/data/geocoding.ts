// Address to coordinates with Google's Geocoding API (needs
// integration_settings.google_maps.api_key). Bulk geocoding is capped at 25
// records per click. Two caches cut billed calls: findCachedCoordinate()
// reuses coordinates already saved on another record at the same address,
// and a browser cache remembers every lookup.
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

// Browser cache keyed by the normalized address, checked before the DB.
// Catches repeats of addresses not saved on any record yet, and remembers
// "no match" (null) so a bad address isn't retried. Kept in localStorage
// with an in-memory Map on top.
const GEOCODE_CACHE_KEY = "fialho_geocode_cache";
type CachedCoord = { lat: number; lng: number } | null;
let geocodeCache: Map<string, CachedCoord> | null = null;

// Keyed by company too, so a shared browser never serves one company's
// coordinates to another.
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
    // localStorage full or unavailable: the in-memory Map still serves this session.
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

// An already-geocoded record (any of the 3 tables) at the same address in
// this company, so a repeat client's address costs no Google call. Narrowed
// by company and ZIP in the query, then matched by normalized address.
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

// Geocodes one address when a record is saved. Callers skip it when there's
// no API key.
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
        // The browser cache already knows this address (or that it has no match).
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
