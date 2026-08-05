// Same 25-record cap per click, same "table = kind" dispatch to whichever
// entity the map pin represents. Swapped from Google's Geocoding API to
// Nominatim (OpenStreetMap) at the user's request — no API key needed, but
// Nominatim's public instance enforces a strict 1 request/second usage
// policy, so records are geocoded sequentially with a delay between calls
// instead of in parallel.
import type { MapKind } from "../domain/types";
import { updateCustomer } from "./customers";
import { updateJob } from "./jobs";
import { updateLead } from "./leads";

export async function updateRecordLatLng(kind: MapKind, id: string, companyId: string, lat: number, lng: number) {
  if (kind === "job") return updateJob(id, companyId, { lat, lng });
  if (kind === "lead") return updateLead(id, companyId, { lat, lng });
  return updateCustomer(id, companyId, { lat, lng });
}

const NOMINATIM_MIN_INTERVAL_MS = 1100;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function geocodeRecords(
  records: { kind: MapKind; id: string; address?: string; city?: string; state?: string; zip?: string }[],
  companyId: string
): Promise<number> {
  let updated = 0;
  for (const record of records.slice(0, 25)) {
    const address = [record.address, record.city, record.state, record.zip].filter(Boolean).join(", ");
    if (!address) continue;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`);
      const data = await res.json();
      const loc = data?.[0];
      if (loc?.lat && loc?.lon) {
        await updateRecordLatLng(record.kind, record.id, companyId, Number(loc.lat), Number(loc.lon));
        updated++;
      }
    } catch {
      // keep trying remaining records
    }
    await sleep(NOMINATIM_MIN_INTERVAL_MS);
  }
  return updated;
}
