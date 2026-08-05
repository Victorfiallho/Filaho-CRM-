import { describe, expect, it } from "vitest";
import { toNumericOrNull } from "./numeric";

describe("toNumericOrNull", () => {
  it("converts blank/missing values to null (not empty string) for numeric DB columns", () => {
    expect(toNumericOrNull("")).toBeNull();
    expect(toNumericOrNull(null)).toBeNull();
    expect(toNumericOrNull(undefined)).toBeNull();
  });

  it("passes real numbers through, including 0", () => {
    expect(toNumericOrNull(0)).toBe(0);
    expect(toNumericOrNull(33.749)).toBe(33.749);
    expect(toNumericOrNull("33.749")).toBe(33.749);
  });

  it("falls back to null for non-numeric garbage instead of sending NaN to Postgres", () => {
    expect(toNumericOrNull("not-a-number")).toBeNull();
  });
});
