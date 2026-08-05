import { describe, expect, it } from "vitest";
import { groupBy, money, normAddress, normEmail, normKey, normName, normPhone, normZip, titleize, unique } from "./format";

describe("money", () => {
  it("formats and rounds", () => {
    expect(money(1234.6)).toBe("$1,235");
    expect(money(0)).toBe("$0");
    expect(money(undefined)).toBe("$0");
    expect(money("")).toBe("$0");
  });
});

describe("normPhone", () => {
  it("strips non-digits and keeps last 10", () => {
    expect(normPhone("(555) 123-4567")).toBe("5551234567");
    expect(normPhone("+1 555 123 4567")).toBe("5551234567");
    expect(normPhone("")).toBe("");
  });
});

describe("normEmail", () => {
  it("lowercases and trims", () => {
    expect(normEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
});

describe("normAddress", () => {
  it("lowercases and collapses punctuation to spaces", () => {
    expect(normAddress("123 Main St., Apt #4")).toBe("123 main st apt 4");
  });
});

describe("normZip", () => {
  it("extracts the first 5-digit run", () => {
    expect(normZip("Atlanta, GA 30303-1234")).toBe("30303");
    expect(normZip("no zip here")).toBe("");
  });
});

describe("normName", () => {
  it("lowercases, turns non-letters into spaces, collapses whitespace", () => {
    expect(normName("  John   O'Malley-Smith 3rd ")).toBe("john o malley smith rd");
  });
});

describe("normKey", () => {
  it("lowercases and collapses non-alphanumerics to single spaces", () => {
    expect(normKey("Deep-Cleaning!!  Service")).toBe("deep cleaning service");
  });
});

describe("titleize", () => {
  it("replaces underscores and capitalizes each word", () => {
    expect(titleize("google_maps")).toBe("Google Maps");
  });
});

describe("unique", () => {
  it("dedupes and sorts", () => {
    expect(unique(["b", "a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("groupBy", () => {
  it("groups rows by key", () => {
    const rows = [{ zip: "303" }, { zip: "303" }, { zip: "404" }];
    expect(groupBy(rows, r => r.zip)).toEqual({ "303": [rows[0], rows[1]], "404": [rows[2]] });
  });
});
