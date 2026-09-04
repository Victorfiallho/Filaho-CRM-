import { describe, expect, it } from "vitest";
import { weeklyTrend } from "./trend";

describe("weeklyTrend", () => {
  const now = new Date("2026-09-04T12:00:00Z");

  it("buckets rows into the right week and sums valueOf", () => {
    const rows = [
      { created_at: "2026-09-03T10:00:00Z", value: 100 }, // this week
      { created_at: "2026-09-01T10:00:00Z", value: 50 },  // this week
      { created_at: "2026-08-26T10:00:00Z", value: 25 }   // last week
    ];
    const points = weeklyTrend(rows, r => r.created_at, r => r.value, 2, now);
    expect(points).toHaveLength(2);
    expect(points[0].value).toBe(25); // last week
    expect(points[1].value).toBe(150); // this week
  });

  it("returns a zero point for a week with no matching rows, instead of skipping it", () => {
    const rows = [{ created_at: "2026-09-03T10:00:00Z", value: 10 }];
    const points = weeklyTrend(rows, r => r.created_at, r => r.value, 3, now);
    expect(points).toHaveLength(3);
    expect(points.map(p => p.value)).toEqual([0, 0, 10]);
  });

  it("counts rows (valueOf returns 1) as well as it sums amounts", () => {
    const rows = [{ created_at: "2026-09-02T10:00:00Z" }, { created_at: "2026-09-03T10:00:00Z" }];
    const points = weeklyTrend(rows, r => r.created_at, () => 1, 1, now);
    expect(points[0].value).toBe(2);
  });

  it("excludes a row exactly on the bucket's start boundary (it belongs to the prior week)", () => {
    // Bucket boundaries are (start, end] — a row exactly at `start` falls in
    // the previous window, not this one.
    const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
    const rows = [{ created_at: boundary, value: 5 }];
    const points = weeklyTrend(rows, r => r.created_at, r => r.value, 1, now);
    expect(points[0].value).toBe(0);
  });
});
