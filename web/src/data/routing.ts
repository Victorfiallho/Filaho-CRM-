// Driving routes for Map & Routes with Google's Directions API: one call
// with waypoints=optimize:true returns both the stop order and the road
// geometry. Best-effort: any failure (no key, over 25 waypoints, no road
// path) returns null and callers fall back to their own order or a straight
// line.
import type { LatLng } from "../domain/geo";

// Decodes Google's encoded polyline (1e5 precision); Directions returns
// only this packed form.
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
    // waypoint_order covers only the middle stops; put the fixed origin and
    // destination back around them.
    const middleOrder: number[] = route.waypoint_order || waypoints.map((_, i) => i);
    const order = [0, ...middleOrder.map((i: number) => i + 1), stops.length - 1];
    return { order, polyline };
  } catch {
    return null;
  }
}

// "Optimize route": stops[0] is the fixed start, the rest are reordered.
// Returns indexes into `stops` in visiting order, or null (the caller then
// uses nearestNeighborRoute/twoOptImprove).
export async function fetchOptimizedOrder(stops: LatLng[], apiKey: string): Promise<number[] | null> {
  const result = await directionsRequest(stops, apiKey, true);
  return result?.order ?? null;
}

// Road geometry for an order already decided (after optimizing or a manual
// reorder), without reordering.
export async function fetchRoutePolyline(stops: LatLng[], apiKey: string): Promise<LatLng[] | null> {
  const result = await directionsRequest(stops, apiKey, false);
  return result?.polyline ?? null;
}
