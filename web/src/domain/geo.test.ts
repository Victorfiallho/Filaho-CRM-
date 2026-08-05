import { describe, expect, it } from "vitest";
import { buildGoogleMapsRouteUrl, clusterByProximity, haversineDistanceKm, nearestNeighborRoute } from "./geo";

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
