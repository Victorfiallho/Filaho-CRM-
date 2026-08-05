import { describe, expect, it } from "vitest";
import { toDateOrNull, toNumericOrNull } from "./numeric";

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

describe("toDateOrNull", () => {
  it("converts blank/missing values to null for date DB columns", () => {
    expect(toDateOrNull("")).toBeNull();
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull(undefined)).toBeNull();
  });

  it("passes a real date string through unchanged", () => {
    expect(toDateOrNull("2024-02-01")).toBe("2024-02-01");
  });
});
