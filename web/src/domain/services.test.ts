import { describe, expect, it } from "vitest";
import { isServiceListChanged, planServiceChanges, renamePasses, serviceProblems } from "./services";

const saved = ["Deep Cleaning", "Recurring Cleaning", "Move-in/Move-out"];
const keep = (names: string[]) => names.map(n => ({ original: n, name: n }));

describe("planServiceChanges", () => {
  it("finds deletes, renames and the new order", () => {
    const plan = planServiceChanges(saved, [
      { original: "Move-in/Move-out", name: "  Move in / Move out " },
      { original: "Deep Cleaning", name: "Deep Cleaning" },
      { original: null, name: "Window Cleaning" }
    ]);
    expect(plan.deletes).toEqual(["Recurring Cleaning"]);
    expect(plan.renames).toEqual([["Move-in/Move-out", "Move in / Move out"]]);
    expect(plan.final).toEqual(["Move in / Move out", "Deep Cleaning", "Window Cleaning"]);
  });

  it("is a no-op for an unchanged list", () => {
    expect(planServiceChanges(saved, keep(saved))).toEqual({ deletes: [], renames: [], final: saved });
    expect(isServiceListChanged(saved, keep(saved))).toBe(false);
    expect(isServiceListChanged(saved, keep([...saved].reverse()))).toBe(true);
  });
});

describe("renamePasses", () => {
  it("renames directly when nothing collides", () => {
    expect(renamePasses([["Refacing", "Cabinet Refacing"]], "t")).toEqual([[["Refacing", "Cabinet Refacing"]]]);
    expect(renamePasses([], "t")).toEqual([]);
  });

  it("swaps two names through placeholders so nothing collides", () => {
    const [first, second] = renamePasses([["A", "B"], ["B", "A"]], "t");
    expect(first).toEqual([["A", "__renaming_t_0"], ["B", "__renaming_t_1"]]);
    expect(second).toEqual([["__renaming_t_0", "B"], ["__renaming_t_1", "A"]]);
  });
});

describe("serviceProblems", () => {
  it("flags empty names and case-insensitive duplicates", () => {
    const { rows, list } = serviceProblems([{ original: null, name: " " }, { original: "Tile", name: "Tile" }, { original: null, name: "tile " }]);
    expect(list).toBeNull();
    expect([...rows]).toEqual([[0, "empty"], [2, "duplicate"]]);
  });

  it("refuses an empty list", () => {
    expect(serviceProblems([]).list).toBe("none");
  });
});
