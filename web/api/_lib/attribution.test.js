import { describe, expect, it } from "vitest";
import { TRACKING_FIELDS, cleanTrackingValue, hasTracking, readTracking } from "./attribution.js";

describe("readTracking", () => {
  it("reads every field from an ad link, IDs as exact text", () => {
    const t = readTracking(new URLSearchParams(
      "utm_source=ig&utm_medium=paid_social&utm_campaign=Teste+Georgia&utm_content=VID+02+-+Cozinha+branca" +
      "&campaign_id=120000000000001&adset_id=120000000000002&ad_id=120000000000003&placement=Instagram_Reels"
    ));
    expect(t).toEqual({
      utm_source: "ig", utm_medium: "paid_social", utm_campaign: "Teste Georgia", utm_term: "", utm_content: "VID 02 - Cozinha branca",
      campaign_id: "120000000000001", adset_id: "120000000000002", ad_id: "120000000000003", placement: "Instagram_Reels"
    });
    expect(hasTracking(t)).toBe(true);
  });

  it("gives every field, empty when absent", () => {
    const t = readTracking(new URLSearchParams(""));
    expect(Object.keys(t)).toEqual(TRACKING_FIELDS);
    expect(hasTracking(t)).toBe(false);
  });
});

describe("cleanTrackingValue", () => {
  it("keeps IDs longer than a JS number can hold", () => {
    expect(cleanTrackingValue("ad_id", " 120212345678901234 ")).toBe("120212345678901234");
  });

  it("drops IDs that aren't digits: unfilled macros, junk, absurd lengths", () => {
    expect(cleanTrackingValue("ad_id", "{{ad.id}}")).toBe("");
    expect(cleanTrackingValue("campaign_id", "12e5")).toBe("");
    expect(cleanTrackingValue("adset_id", "1".repeat(31))).toBe("");
  });

  it("strips control characters and caps text", () => {
    expect(cleanTrackingValue("utm_campaign", "A\u0000B\nC")).toBe("ABC");
    expect(cleanTrackingValue("utm_content", "x".repeat(500))).toHaveLength(200);
    expect(cleanTrackingValue("placement", null)).toBe("");
  });
});
