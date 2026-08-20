// Real driving-route geometry for the Map & Routes polyline, via OSRM's free
// public demo server — same "no API key, OpenStreetMap ecosystem" choice
// already made for geocoding (see data/geocoding.ts). Best-effort: this is a
// shared demo server, not an SLA'd service, so any failure (network, rate
// limit, no road path between the points) just means the caller falls back
// to the straight-line distance it already draws — never something that
// should block or break the route view.
import type { LatLng } from "../domain/geo";

export async function fetchDrivingRoute(stops: LatLng[]): Promise<LatLng[] | null> {
  if (stops.length < 2) return null;
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(";");
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    if (!res.ok) return null;
    const data = await res.json();
    const line = data?.routes?.[0]?.geometry?.coordinates;
    if (data?.code !== "Ok" || !Array.isArray(line)) return null;
    return line.map(([lng, lat]: [number, number]) => ({ lat, lng }));
  } catch {
    return null;
  }
}
