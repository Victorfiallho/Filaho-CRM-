import { describe, expect, it } from "vitest";
import { activationProblems, consentBadge, isSafeLogoUrl, parseList, parseZipPrefixes, renderConsentText, slugify } from "./consent";

describe("consentBadge", () => {
  it("formats the per-channel state", () => {
    expect(consentBadge("sms", "opted_in")).toBe("SMS: opted in");
    expect(consentBadge("sms", "suppressed")).toBe("SMS: suppressed");
    expect(consentBadge("email", undefined)).toBe("Email: not opted in");
  });
});

describe("booking page admin helpers", () => {
  it("slugifies business names", () => {
    expect(slugify("Peach Fresh")).toBe("peach-fresh");
    expect(slugify("  Wish Cabinets & Co. ")).toBe("wish-cabinets-co");
    expect(slugify("Área Limpa")).toBe("area-limpa");
  });

  it("parses lists from lines or commas", () => {
    expect(parseList("Marietta\nRoswell, Alpharetta\n\nMarietta")).toEqual(["Marietta", "Roswell", "Alpharetta"]);
  });

  it("separates valid ZIP prefixes from typos", () => {
    expect(parseZipPrefixes("300, 3006\n30339, 30x")).toEqual({ prefixes: ["300", "3006", "30339"], invalid: ["30x"] });
  });

  it("lists what blocks activation", () => {
    const ready = { address_line: "1 Main", address_city: "Marietta", address_state: "GA", address_zip: "30060", phone: "1", email: "a@b.c", zip_prefixes: ["300"] };
    expect(activationProblems(ready)).toEqual([]);
    expect(activationProblems({ ...ready, address_zip: "", zip_prefixes: [] })).toEqual(["address", "zips"]);
  });

  it("only accepts https or same-site logo URLs", () => {
    expect(isSafeLogoUrl("https://cdn.example.com/logo.png")).toBe(true);
    expect(isSafeLogoUrl("/logos/peach_fresh.png")).toBe(true);
    expect(isSafeLogoUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLogoUrl("//evil.com/x.png")).toBe(false);
    expect(isSafeLogoUrl("http://example.com/x.png")).toBe(false);
  });

  it("renders {Business} placeholders", () => {
    expect(renderConsentText("texts from {Business}.", "Peach Fresh")).toBe("texts from Peach Fresh.");
  });
});
