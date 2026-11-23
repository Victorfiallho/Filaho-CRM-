import { describe, expect, it } from "vitest";
import { AB_TEST, assignVariant, isBot, readCookie } from "./abTest.js";

describe("assignVariant", () => {
  it("splits new visitors by the coin and remembers it", () => {
    expect(assignVariant({ cookieHeader: "", random: () => 0.2 }).variant).toBe("a");
    const b = assignVariant({ cookieHeader: "", random: () => 0.7 });
    expect(b.variant).toBe("b");
    expect(b.setCookie).toMatch(new RegExp(`^${AB_TEST.cookie}=b; Path=/book; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly$`));
  });

  it("keeps a returning visitor's variant and doesn't re-set the cookie", () => {
    expect(assignVariant({ cookieHeader: `x=1; ${AB_TEST.cookie}=b`, random: () => 0 })).toEqual({ variant: "b", setCookie: null });
  });

  it("?ab= forces a variant for QA and sticks it", () => {
    const r = assignVariant({ cookieHeader: `${AB_TEST.cookie}=a`, forced: "b" });
    expect(r.variant).toBe("b");
    expect(r.setCookie).toContain(`${AB_TEST.cookie}=b`);
  });

  it("ignores junk in the cookie or the query", () => {
    expect(["a", "b"]).toContain(assignVariant({ cookieHeader: `${AB_TEST.cookie}=zzz`, forced: "<script>" }).variant);
  });
});

describe("readCookie", () => {
  it("finds one cookie among many", () => {
    expect(readCookie("a=1; fhi_ab=b; c=3", "fhi_ab")).toBe("b");
    expect(readCookie("", "fhi_ab")).toBe("");
  });
});

describe("isBot", () => {
  it("doesn't count previews, crawlers or scripts as visits", () => {
    for (const ua of ["facebookexternalhit/1.1", "meta-externalads/1.1", "Googlebot/2.1", "python-requests/2.31", "curl/8.0", "", "Mozilla/5.0 HeadlessChrome/120"]) {
      expect(isBot(ua), ua).toBe(true);
    }
  });

  it("counts real browsers", () => {
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isBot("Mozilla/5.0 (Linux; Android 14; Instagram 300.0.0.0)")).toBe(false);
  });
});
