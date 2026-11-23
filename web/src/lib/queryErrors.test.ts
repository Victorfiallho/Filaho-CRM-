import { describe, expect, it } from "vitest";
import { failedActiveQueries } from "./queryErrors";

const q = (status: string, observers: number) => ({ state: { status }, getObserversCount: () => observers });

describe("failedActiveQueries", () => {
  it("keeps failed loads a screen is showing", () => {
    const failed = q("error", 1);
    expect(failedActiveQueries([q("success", 2), failed, q("pending", 1)])).toEqual([failed]);
  });

  it("ignores failed loads no screen uses anymore", () => {
    expect(failedActiveQueries([q("error", 0)])).toEqual([]);
  });

  it("is empty when everything loaded", () => {
    expect(failedActiveQueries([q("success", 1), q("success", 0)])).toEqual([]);
  });
});
