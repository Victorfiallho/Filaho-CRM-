import { describe, expect, it } from "vitest";
import { shiftDays, weekDays, weekLabel, weekStart, ymd } from "./calendarWeek";

describe("weekDays", () => {
  it("is Sunday to Saturday around the date", () => {
    expect(weekDays(new Date(2026, 10, 23))).toEqual(["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"]);
  });

  it("starts on the date itself when it's a Sunday", () => {
    expect(weekDays(new Date(2026, 10, 22))[0]).toBe("2026-11-22");
  });

  it("crosses months and years", () => {
    expect(weekDays(new Date(2026, 11, 31))).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("shiftDays / weekStart", () => {
  it("moves by whole weeks without drifting", () => {
    const next = shiftDays(new Date(2026, 10, 23), 7);
    expect(ymd(next)).toBe("2026-11-30");
    expect(ymd(weekStart(next))).toBe("2026-11-29");
  });
});

describe("weekLabel", () => {
  it("names the range in the person's language", () => {
    const pt = weekLabel(new Date(2026, 10, 23), "pt-BR");
    expect(pt).toContain("22");
    expect(pt).toContain("28");
    expect(pt).toContain("2026");
    expect(weekLabel(new Date(2026, 10, 30), "en-US")).toMatch(/Nov.*Dec|Nov 29/);
  });
});
