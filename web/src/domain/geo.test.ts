import { describe, expect, it } from "vitest";
import { buildGoogleMapsRouteUrl, clusterByProximity, haversineDistanceKm, nearestNeighborRoute, twoOptImprove, type LatLng } from "./geo";

describe("haversineDistanceKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistanceKm({ lat: 33.749, lng: -84.388 }, { lat: 33.749, lng: -84.388 })).toBe(0);
  });

  it("matches the known distance between Atlanta and Marietta (~ 24km)", () => {
    const atlanta = { lat: 33.749, lng: -84.388 };
    const marietta = { lat: 33.9526, lng: -84.5499 };
    const km = haversineDistanceKm(atlanta, marietta);
    expect(km).toBeGreaterThan(20);
    expect(km).toBeLessThan(30);
  });
});

describe("nearestNeighborRoute", () => {
  it("visits the closest point first, not just in list order", () => {
    const start = { lat: 0, lng: 0 };
    const far = { id: "far", lat: 0, lng: 10 };
    const near = { id: "near", lat: 0, lng: 1 };
    const mid = { id: "mid", lat: 0, lng: 5 };
    const route = nearestNeighborRoute([far, mid, near], start);
    expect(route.map(p => p.id)).toEqual(["near", "mid", "far"]);
  });

  it("returns all points exactly once", () => {
    const start = { lat: 0, lng: 0 };
    const points = [
      { id: "a", lat: 1, lng: 1 },
      { id: "b", lat: -1, lng: -1 },
      { id: "c", lat: 2, lng: -2 }
    ];
    const route = nearestNeighborRoute(points, start);
    expect(route).toHaveLength(3);
    expect(new Set(route.map(p => p.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("handles an empty list", () => {
    expect(nearestNeighborRoute([], { lat: 0, lng: 0 })).toEqual([]);
  });
});

function routeLength(points: LatLng[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + haversineDistanceKm(points[i], p), 0);
}

describe("twoOptImprove", () => {
  it("uncrosses a route with a known crossing (both diagonals of a unit square)", () => {
    const a = { id: "a", lat: 0, lng: 0 };
    const b = { id: "b", lat: 1, lng: 1 };
    const c = { id: "c", lat: 0, lng: 1 };
    const d = { id: "d", lat: 1, lng: 0 };
    // a-b and c-d are the two crossing diagonals; a-c-b-d traces the square's
    // perimeter instead — shorter, and the fix 2-opt should find.
    const improved = twoOptImprove([a, b, c, d]);
    expect(improved.map(p => p.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("never leaves the route longer than it started", () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }, { lat: 0.5, lng: 0.5 }];
    const before = routeLength(points);
    const after = twoOptImprove(points);
    expect(routeLength(after)).toBeLessThanOrEqual(before + 1e-9);
  });

  it("keeps the same set of points, just reordered", () => {
    const points = [
      { id: "a", lat: 0, lng: 0 }, { id: "b", lat: 5, lng: 5 },
      { id: "c", lat: 0, lng: 5 }, { id: "d", lat: 5, lng: 0 }, { id: "e", lat: 2, lng: 8 }
    ];
    const improved = twoOptImprove(points);
    expect(improved).toHaveLength(points.length);
    expect(new Set(improved.map(p => p.id))).toEqual(new Set(points.map(p => p.id)));
  });

  it("leaves routes shorter than 4 stops unchanged (nothing to uncross)", () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }];
    expect(twoOptImprove(points)).toEqual(points);
  });
});

describe("buildGoogleMapsRouteUrl", () => {
  it("returns an empty string for no stops", () => {
    expect(buildGoogleMapsRouteUrl([])).toBe("");
  });

  it("builds a destination-only link for a single stop", () => {
    expect(buildGoogleMapsRouteUrl([{ lat: 1, lng: 2 }])).toBe("https://www.google.com/maps/dir/?api=1&destination=1,2");
  });

  it("builds origin/destination/waypoints for multiple stops", () => {
    const url = buildGoogleMapsRouteUrl([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }]);
    expect(url).toContain("origin=1%2C1");
    expect(url).toContain("destination=3%2C3");
    expect(url).toContain("waypoints=2%2C2");
    expect(url).toContain("travelmode=driving");
  });

  it("caps waypoints instead of overflowing the URL", () => {
    const stops = Array.from({ length: 30 }, (_, i) => ({ lat: i, lng: i }));
    const url = buildGoogleMapsRouteUrl(stops);
    const waypointsParam = new URL(url).searchParams.get("waypoints") || "";
    expect(waypointsParam.split("|").length).toBeLessThanOrEqual(23);
  });
});

describe("clusterByProximity", () => {
  it("groups nearby points into the same bucket", () => {
    const a = { id: "a", lat: 33.749, lng: -84.388 };
    const b = { id: "b", lat: 33.751, lng: -84.389 };
    const groups = clusterByProximity([a, b], 0.05);
    expect(Object.keys(groups)).toHaveLength(1);
    expect(groups[Object.keys(groups)[0]]).toHaveLength(2);
  });

  it("separates far-apart points into different buckets", () => {
    const a = { id: "a", lat: 33.749, lng: -84.388 };
    const b = { id: "b", lat: 40.0, lng: -74.0 };
    const groups = clusterByProximity([a, b], 0.05);
    expect(Object.keys(groups)).toHaveLength(2);
  });
});
