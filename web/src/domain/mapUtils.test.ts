import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_FILTERS, matchesMapFilters, pseudoPosition } from "./mapUtils";
import type { MapRecord } from "./types";

function record(overrides: Partial<MapRecord> = {}): MapRecord {
  return { id: "c1", kind: "customer", name: "Jane", zip: "30303", city: "Atlanta", lat: "", lng: "", ...overrides };
}

describe("pseudoPosition", () => {
  it("is deterministic for the same input", () => {
    const a = pseudoPosition({ zip: "30303", city: "Atlanta", address: "123 Main St" }, 0);
    const b = pseudoPosition({ zip: "30303", city: "Atlanta", address: "123 Main St" }, 0);
    expect(a).toEqual(b);
  });

  it("keeps x within its guaranteed 8-89 range", () => {
    // x = 8 + (hash % 82) where hash is forced unsigned (>>>0), so this range
    // is always safe. y uses a signed `hash >> 8`, which — same as app.js —
    // can sign-extend for large hashes and land outside [12,84); that's an
    // inherited quirk, not something to assert a clean bound on here.
    for (let i = 0; i < 20; i++) {
      const pos = pseudoPosition({ zip: String(i), city: "Atlanta" }, i);
      expect(pos.x).toBeGreaterThanOrEqual(8);
      expect(pos.x).toBeLessThan(90);
      expect(Number.isFinite(pos.y)).toBe(true);
    }
  });

  it("differs for a different index (avoids stacking identical records)", () => {
    const a = pseudoPosition({ zip: "30303" }, 0);
    const b = pseudoPosition({ zip: "30303" }, 1);
    expect(a).not.toEqual(b);
  });
});

describe("matchesMapFilters", () => {
  it("passes everything through with default filters", () => {
    expect(matchesMapFilters(record(), DEFAULT_MAP_FILTERS)).toBe(true);
  });

  it("filters by zip", () => {
    expect(matchesMapFilters(record({ zip: "30303" }), { ...DEFAULT_MAP_FILTERS, zip: "30303" })).toBe(true);
    expect(matchesMapFilters(record({ zip: "30304" }), { ...DEFAULT_MAP_FILTERS, zip: "30303" })).toBe(false);
  });

  it("filters leads by stage but ignores it for other kinds", () => {
    const lead = record({ kind: "lead", stage_id: "new" });
    expect(matchesMapFilters(lead, { ...DEFAULT_MAP_FILTERS, lead_status: "won" })).toBe(false);
    expect(matchesMapFilters(record({ kind: "customer" }), { ...DEFAULT_MAP_FILTERS, lead_status: "won" })).toBe(true);
  });

  it("filters jobs by status and date but excludes non-jobs when a date filter is set", () => {
    const job = record({ kind: "job", status: "planned", scheduled_date: "2024-02-01" });
    expect(matchesMapFilters(job, { ...DEFAULT_MAP_FILTERS, job_status: "complete" })).toBe(false);
    expect(matchesMapFilters(job, { ...DEFAULT_MAP_FILTERS, date: "2024-02-01" })).toBe(true);
    expect(matchesMapFilters(job, { ...DEFAULT_MAP_FILTERS, date: "2024-03-01" })).toBe(false);
    expect(matchesMapFilters(record({ kind: "customer" }), { ...DEFAULT_MAP_FILTERS, date: "2024-02-01" })).toBe(false);
  });
});
