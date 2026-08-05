// Pure geo helpers for Map & Routes: distance, route ordering, a Google Maps
// multi-stop link, and proximity-based grouping. No business rules ported
// from app.js here — this is new functionality (route planning) the
// original MVP never had.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Greedy nearest-neighbor ordering: from `start`, repeatedly jump to the
// closest not-yet-visited point. Not an optimal (TSP) route, but a cheap
// heuristic that avoids obviously backtracking across town — good enough for
// a handful of stops in a day, where "good order" matters more than "perfect
// order" and there's no budget for real route-optimization APIs.
export function nearestNeighborRoute<T extends LatLng>(points: T[], start: LatLng): T[] {
  const remaining = [...points];
  const ordered: T[] = [];
  let from = start;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistanceKm(from, remaining[i]);
      if (d < bestDist) { bestDist = d; bestIndex = i; }
    }
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    from = next;
  }
  return ordered;
}

// Google Maps' consumer web directions URL accepts an origin, a destination,
// and up to ~23 waypoints in between. A field-service day rarely has more
// stops than that, so no extra pagination/splitting is implemented here.
const MAX_GOOGLE_MAPS_WAYPOINTS = 23;

export function buildGoogleMapsRouteUrl(stops: LatLng[]): string {
  if (!stops.length) return "";
  const coord = (p: LatLng) => `${p.lat},${p.lng}`;
  if (stops.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&destination=${coord(stops[0])}`;
  }
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(1, -1).slice(0, MAX_GOOGLE_MAPS_WAYPOINTS);
  const params = new URLSearchParams({
    api: "1",
    origin: coord(origin),
    destination: coord(destination),
    travelmode: "driving"
  });
  if (waypoints.length) params.set("waypoints", waypoints.map(coord).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Groups points into rough geographic clusters by snapping lat/lng to a grid
// cell — cheap stand-in for real clustering (k-means/DBSCAN would be
// overkill for a few dozen stops). ~0.05 degrees is roughly 5km at Atlanta's
// latitude, a reasonable "same neighborhood" radius for route grouping.
export function clusterByProximity<T extends LatLng>(points: T[], precisionDegrees = 0.05): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const point of points) {
    const key = `${Math.round(point.lat / precisionDegrees) * precisionDegrees},${Math.round(point.lng / precisionDegrees) * precisionDegrees}`;
    groups[key] = groups[key] || [];
    groups[key].push(point);
  }
  return groups;
}
