// Ported verbatim from app.js (geocodeVisibleRecords) — same 25-record cap per
// click, same "table = kind" dispatch to whichever entity the map pin represents.
import type { MapKind } from "../domain/types";
import { updateCustomer } from "./customers";
import { updateJob } from "./jobs";
import { updateLead } from "./leads";

export async function updateRecordLatLng(kind: MapKind, id: string, companyId: string, lat: number, lng: number) {
  if (kind === "job") return updateJob(id, companyId, { lat, lng });
  if (kind === "lead") return updateLead(id, companyId, { lat, lng });
  return updateCustomer(id, companyId, { lat, lng });
}

export async function geocodeRecords(
  records: { kind: MapKind; id: string; address?: string; city?: string; state?: string; zip?: string }[],
  companyId: string,
  apiKey: string
): Promise<number> {
  let updated = 0;
  for (const record of records.slice(0, 25)) {
    const address = [record.address, record.city, record.state, record.zip].filter(Boolean).join(", ");
    if (!address) continue;
    try {
      const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`);
      const data = await res.json();
      const loc = data.results?.[0]?.geometry?.location;
      if (loc) {
        await updateRecordLatLng(record.kind, record.id, companyId, loc.lat, loc.lng);
        updated++;
      }
    } catch {
      // keep trying remaining records
    }
  }
  return updated;
}
