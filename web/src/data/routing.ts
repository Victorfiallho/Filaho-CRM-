// Real driving-route geometry AND stop ordering for the Map & Routes planner,
// via Google's Directions API (waypoints=optimize:true does both in one call
// — replaces the old OSRM-for-geometry-only + nearestNeighborRoute/twoOptImprove
// combo for the initial "Optimize route" click). Best-effort throughout: any
// failure (network, no API key yet, >25 waypoints, no road path) resolves to
// null so callers fall back to their own ordering / a straight-line preview,
// same "never blocks the route view" philosophy the OSRM integration had.
import type { LatLng } from "../domain/geo";

// Standard Google polyline algorithm (encoded with 1e5 precision) — Directions
// API has no JSON-array-of-coordinates option, only this packed string, and
// there's no existing decoder anywhere in the app to reuse.
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0; shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

const MAX_DIRECTIONS_WAYPOINTS = 23; // + origin + destination = Google's 25-waypoint cap

async function directionsRequest(stops: LatLng[], apiKey: string, optimize: boolean): Promise<{ order: number[]; polyline: LatLng[] } | null> {
  if (stops.length < 2 || !apiKey) return null;
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(1, -1).slice(0, MAX_DIRECTIONS_WAYPOINTS);
  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    key: apiKey
  });
  if (waypoints.length) {
    const prefix = optimize ? "optimize:true|" : "";
    params.set("waypoints", `${prefix}${waypoints.map(p => `${p.lat},${p.lng}`).join("|")}`);
  }
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (data?.status !== "OK" || !route) return null;
    const polyline = route.overview_polyline?.points ? decodePolyline(route.overview_polyline.points) : [];
    // waypoint_order only covers the middle waypoints — stitch origin/destination
    // back on at their fixed positions to get a full stops-array ordering.
    const middleOrder: number[] = route.waypoint_order || waypoints.map((_, i) => i);
    const order = [0, ...middleOrder.map((i: number) => i + 1), stops.length - 1];
    return { order, polyline };
  } catch {
    return null;
  }
}

// Used once by "Optimize route": `stops[0]` is the fixed starting point
// (current location / custom start / first candidate), the rest are
// candidates to reorder. Returns indices into `stops` in visiting order, or
// null on any failure so the caller falls back to nearestNeighborRoute/twoOptImprove.
export async function fetchOptimizedOrder(stops: LatLng[], apiKey: string): Promise<number[] | null> {
  const result = await directionsRequest(stops, apiKey, true);
  return result?.order ?? null;
}

// Used whenever the route view needs to (re)draw real road geometry for an
// already-decided stop order (right after optimizing, or after a manual
// up/down reorder) — preserves the given order rather than re-optimizing it.
export async function fetchRoutePolyline(stops: LatLng[], apiKey: string): Promise<LatLng[] | null> {
  const result = await directionsRequest(stops, apiKey, false);
  return result?.polyline ?? null;
}
