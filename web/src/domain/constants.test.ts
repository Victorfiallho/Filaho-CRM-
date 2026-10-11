import { describe, expect, it } from "vitest";
import { MODULES, NAV_GROUPS } from "./constants";

describe("NAV_GROUPS", () => {
  it("places every module in exactly one sidebar group", () => {
    const grouped = NAV_GROUPS.flatMap(([, ids]) => ids);
    expect([...grouped].sort()).toEqual(MODULES.map(([id]) => id).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
