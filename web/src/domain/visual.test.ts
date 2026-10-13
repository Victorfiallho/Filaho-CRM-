import { describe, expect, it } from "vitest";
import { avatarInitials, dotColumns, readableOn, stageTone } from "./visual";

describe("dotColumns", () => {
  it("scales each period against the largest one", () => {
    expect(dotColumns([0, 5, 10], 5, 3)).toEqual([0, 3, 5]);
  });

  it("gives any non-zero value at least one dot", () => {
    expect(dotColumns([1, 100], 5, 2)).toEqual([1, 5]);
  });

  it("pads short series on the left and keeps only the most recent columns", () => {
    expect(dotColumns([4], 4, 3)).toEqual([0, 0, 4]);
    expect(dotColumns([9, 9, 1, 2], 2, 2)).toEqual([1, 2]);
  });

  it("is all empty when nothing happened", () => {
    expect(dotColumns([0, 0, 0], 5, 3)).toEqual([0, 0, 0]);
  });
});

describe("stageTone", () => {
  it("pins won/lost and walks the palette for open stages", () => {
    expect(stageTone({ id: "won", type: "won" }, 4)).toBe("green");
    expect(stageTone({ id: "lost", type: "lost" }, 5)).toBe("rose");
    expect(stageTone({ id: "new", type: "open" }, 0)).toBe("slate");
    expect(stageTone({ id: "contacted", type: "open" }, 1)).toBe("blue");
  });
});

describe("readableOn", () => {
  it("picks white on dark accents and near-black on light ones", () => {
    expect(readableOn("#315c7c")).toBe("#ffffff"); // Wish Cabinets
    expect(readableOn("#f36f45")).toBe("#111111"); // Peach Fresh coral
    expect(readableOn("#fde68a")).toBe("#111111");
    expect(readableOn("nope")).toBe("#ffffff");
  });
});

describe("avatarInitials", () => {
  it("uses first and last names", () => {
    expect(avatarInitials("Victor Fialho")).toBe("VF");
    expect(avatarInitials("Ana Maria Souza")).toBe("AS");
    expect(avatarInitials("")).toBe("?");
  });
});
