import { describe, expect, it } from "vitest";
import { monotonePath, niceCeiling, periodChange, tickIndexes } from "./chartPath";

// Samples a path's cubic segments to find the lowest point it reaches.
function maxY(d: string): number {
  const nums = d.replace(/[MLC]/g, " ").trim().split(/[\s,]+/).map(Number);
  let max = -Infinity;
  for (let i = 1; i < nums.length; i += 2) max = Math.max(max, nums[i]);
  return max;
}

describe("monotonePath", () => {
  it("never pushes control points below the baseline next to a flat zero run", () => {
    // y grows downward in SVG: baseline is y=100, a 6-lead spike is y=40.
    const pts = [0, 0, 6, 0, 3, 0].map((v, i) => ({ x: i * 10, y: 100 - v * 10 }));
    expect(maxY(monotonePath(pts))).toBeLessThanOrEqual(100);
  });

  it("passes through every point", () => {
    const pts = [{ x: 0, y: 10 }, { x: 10, y: 30 }, { x: 20, y: 5 }];
    const d = monotonePath(pts);
    expect(d.startsWith("M0,10")).toBe(true);
    expect(d).toContain("10,30C");
    expect(d.endsWith("20,5")).toBe(true);
  });

  it("handles tiny inputs", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 1, y: 2 }])).toBe("M1,2");
    expect(monotonePath([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBe("M0,0L5,5");
  });
});

describe("periodChange", () => {
  it("compares the recent half with the half before it", () => {
    expect(periodChange([1, 1, 1, 2, 2, 2])).toEqual({ recent: 6, previous: 3, pct: 100 });
    expect(periodChange([4, 4, 2, 2])).toEqual({ recent: 4, previous: 8, pct: -50 });
  });

  it("has no percentage when the earlier half was empty", () => {
    expect(periodChange([0, 0, 3, 1]).pct).toBeNull();
  });
});

describe("axis helpers", () => {
  it("rounds the axis max up to a clean number", () => {
    expect(niceCeiling(6)).toBe(10);
    expect(niceCeiling(17)).toBe(20);
    expect(niceCeiling(0)).toBe(1);
  });

  it("spaces x ticks evenly and keeps both ends", () => {
    expect(tickIndexes(12, 4)).toEqual([0, 4, 7, 11]);
    expect(tickIndexes(3, 4)).toEqual([0, 1, 2]);
  });
});
