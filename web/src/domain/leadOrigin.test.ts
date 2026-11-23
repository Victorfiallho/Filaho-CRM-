import { describe, expect, it } from "vitest";
import { leadOrigin, placementLabel, platformLabel } from "./leadOrigin";

const empty = { utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "" };

describe("leadOrigin", () => {
  it("reads a Meta ad link the way the team talks about it", () => {
    expect(leadOrigin({
      utm_source: "ig", utm_medium: "paid_social", utm_campaign: "WC | Leads | Kitchen Cabinets | GA", utm_content: "VID 02 | Cozinha branca",
      campaign_id: "120000000000001", adset_id: "120000000000002", ad_id: "120000000000003", placement: "Instagram_Reels"
    })).toEqual({
      platform: "Instagram", medium: "paid", mediumRaw: "paid_social",
      campaign: "WC | Leads | Kitchen Cabinets | GA", ad: "VID 02 | Cozinha branca",
      campaignId: "120000000000001", adsetId: "120000000000002", adId: "120000000000003", placement: "Instagram Reels"
    });
  });

  it("keeps long ad IDs digit for digit", () => {
    expect(leadOrigin({ ...empty, ad_id: "120212345678901234" })?.adId).toBe("120212345678901234");
  });

  it("is just the platform when that's all the link had", () => {
    const o = leadOrigin({ ...empty, utm_source: "fb" });
    expect(o).toMatchObject({ platform: "Facebook", medium: "", campaign: "", ad: "", adId: "", placement: "" });
  });

  it("is null for untracked visits and rows from before tracking", () => {
    expect(leadOrigin(null)).toBeNull();
    expect(leadOrigin(undefined)).toBeNull();
    expect(leadOrigin(empty)).toBeNull();
    expect(leadOrigin({ ...empty, campaign_id: "", ad_id: "  " })).toBeNull();
  });

  it("shows an unknown medium as typed", () => {
    expect(leadOrigin({ ...empty, utm_source: "flyer", utm_medium: "qr" })).toMatchObject({ platform: "flyer", medium: "", mediumRaw: "qr" });
  });
});

describe("labels", () => {
  it("names platforms in plain words, case-insensitively", () => {
    expect(platformLabel("IG")).toBe("Instagram");
    expect(platformLabel("facebook")).toBe("Facebook");
    expect(platformLabel("an")).toBe("Audience Network");
    expect(platformLabel("newsletter")).toBe("newsletter");
    expect(platformLabel("")).toBe("");
  });

  it("turns placement codes into words", () => {
    expect(placementLabel("Instagram_Reels")).toBe("Instagram Reels");
    expect(placementLabel("facebook_mobile_feed")).toBe("Facebook Mobile Feed");
    expect(placementLabel("Instagram+Stories")).toBe("Instagram Stories");
    expect(placementLabel("")).toBe("");
  });
});
