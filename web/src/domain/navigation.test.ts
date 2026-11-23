import { describe, expect, it } from "vitest";
import { MODULES } from "./constants";
import { BOTTOM_NAV, PRIMARY_NAV, splitNav } from "./navigation";

const all = () => true;

describe("splitNav", () => {
  it("puts the daily screens up front and everything else under More, once each", () => {
    const { primary, more } = splitNav(all);
    expect(primary).toEqual(PRIMARY_NAV);
    const inMore = more.flatMap(([, ids]) => ids);
    expect(inMore).not.toContain("dashboard");
    for (const id of PRIMARY_NAV) expect(inMore).not.toContain(id);
    expect(["dashboard", ...primary, ...inMore].sort()).toEqual(MODULES.map(([id]) => id).sort());
  });

  it("keeps each screen in its section", () => {
    const { more } = splitNav(all);
    expect(more.find(([g]) => g === "Sales")?.[1]).toEqual(["quotes", "messages", "booking-page"]);
    expect(more.find(([g]) => g === "Operations")?.[1]).toEqual(["map"]);
  });

  it("hides what the person can't see, and drops sections left empty", () => {
    const { primary, more } = splitNav(id => !["customers", "company-financials", "reports"].includes(id));
    expect(primary).not.toContain("customers");
    expect(more.map(([g]) => g)).not.toContain("Finance");
  });

  it("bottom bar screens are real modules", () => {
    const ids = MODULES.map(([id]) => id);
    for (const id of BOTTOM_NAV) expect(ids).toContain(id);
  });
});
