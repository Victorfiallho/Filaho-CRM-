// Geo helpers for Map & Routes: distance, stop ordering, a Google Maps
// multi-stop link and proximity grouping.

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

// Greedy nearest neighbor: from `start`, always go to the closest stop not
// visited yet. Not optimal, but avoids crossing town back and forth.
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

// 2-opt: reverse a segment whenever that shortens the route, until nothing
// improves (or maxIterations). Open path, no return leg. Runs on the
// nearest-neighbor order to remove the crossings it leaves.
export function twoOptImprove<T extends LatLng>(route: T[], maxIterations = 200): T[] {
  if (route.length < 4) return route;
  const result = [...route];
  let improved = true;
  let iterations = 0;
  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;
    for (let i = 0; i < result.length - 3; i++) {
      for (let k = i + 2; k < result.length - 1; k++) {
        const a = result[i], b = result[i + 1];
        const c = result[k], d = result[k + 1];
        const before = haversineDistanceKm(a, b) + haversineDistanceKm(c, d);
        const after = haversineDistanceKm(a, c) + haversineDistanceKm(b, d);
        if (after + 1e-9 < before) {
          let lo = i + 1, hi = k;
          while (lo < hi) {
            const tmp = result[lo]; result[lo] = result[hi]; result[hi] = tmp;
            lo++; hi--;
          }
          improved = true;
        }
      }
    }
  }
  return result;
}

// Google Maps' web directions URL takes an origin, a destination and about
// 23 waypoints; a field-service day rarely has more.
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

// Rough clusters by snapping lat/lng to a grid. 0.05 degrees is about 5 km
// at Atlanta's latitude: "same neighborhood".
export function clusterByProximity<T extends LatLng>(points: T[], precisionDegrees = 0.05): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const point of points) {
    const key = `${Math.round(point.lat / precisionDegrees) * precisionDegrees},${Math.round(point.lng / precisionDegrees) * precisionDegrees}`;
    groups[key] = groups[key] || [];
    groups[key].push(point);
  }
  return groups;
}
