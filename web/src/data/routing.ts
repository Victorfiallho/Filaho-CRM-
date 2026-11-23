// Driving routes for Map & Routes with Google's Directions service: one call
// with optimizeWaypoints returns both the stop order and the road
// geometry. Best-effort: any failure (no key, over 25 waypoints, no road
// path) returns null and callers fall back to their own order or a straight
// line.
import type { LatLng } from "../domain/geo";
import { loadGoogleMapsScript } from "../lib/googleMaps";

const MAX_DIRECTIONS_WAYPOINTS = 23; // + origin + destination = Google's 25-waypoint cap

// Through the Maps JavaScript API's DirectionsService, not the REST endpoint:
// that one doesn't answer browsers (no CORS) and refuses keys restricted to
// websites, which is what a browser key should be.
async function directionsRequest(stops: LatLng[], apiKey: string, optimize: boolean): Promise<{ order: number[]; polyline: LatLng[] } | null> {
  if (stops.length < 2 || !apiKey) return null;
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(1, -1).slice(0, MAX_DIRECTIONS_WAYPOINTS);
  try {
    await loadGoogleMapsScript(apiKey);
    const g = window.google.maps;
    const result = await new g.DirectionsService().route({
      origin,
      destination,
      waypoints: waypoints.map(location => ({ location, stopover: true })),
      optimizeWaypoints: optimize,
      travelMode: g.TravelMode.DRIVING
    });
    const route = result?.routes?.[0];
    if (!route) return null;
    const polyline: LatLng[] = (route.overview_path || []).map((p: { lat(): number; lng(): number }) => ({ lat: p.lat(), lng: p.lng() }));
    // waypoint_order covers only the middle stops; put the fixed origin and
    // destination back around them.
    const middleOrder: number[] = route.waypoint_order || waypoints.map((_, i) => i);
    const order = [0, ...middleOrder.map((i: number) => i + 1), stops.length - 1];
    return { order, polyline };
  } catch (err) {
    console.error("[routing] Google Directions failed", err);
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
