// "Where did this person come from?" for a lead's record: the tracking
// values its booking request saved (web/api/_lib/attribution.js), turned
// into what the team reads. Pure; the panel only picks labels.
import type { BookingRequest } from "./types";

export type OriginMedium = "paid" | "organic" | "email" | "sms" | "referral" | "";

export interface LeadOrigin {
  platform: string;
  medium: OriginMedium;
  // Unknown mediums are shown as typed.
  mediumRaw: string;
  campaign: string;
  ad: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  placement: string;
}

const PLATFORMS: Record<string, string> = {
  ig: "Instagram", instagram: "Instagram",
  fb: "Facebook", facebook: "Facebook",
  an: "Audience Network", audience_network: "Audience Network",
  msg: "Messenger", messenger: "Messenger",
  meta: "Meta", threads: "Threads", wa: "WhatsApp", whatsapp: "WhatsApp",
  google: "Google", youtube: "YouTube", tiktok: "TikTok", nextdoor: "Nextdoor",
  yelp: "Yelp", thumbtack: "Thumbtack", bing: "Bing", email: "Email", sms: "SMS"
};

const MEDIUMS: Record<string, OriginMedium> = {
  paid_social: "paid", paidsocial: "paid", paid: "paid", cpc: "paid", ppc: "paid", ads: "paid", ad: "paid", display: "paid", paid_search: "paid",
  social: "organic", organic: "organic", organic_social: "organic",
  email: "email", newsletter: "email",
  sms: "sms", text: "sms",
  referral: "referral"
};

// "Instagram_Reels" -> "Instagram Reels"; "instagram_stories" -> "Instagram Stories".
export function placementLabel(raw: string): string {
  const words = String(raw || "").replace(/[_+]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words) return "";
  return words.split(" ").map(w => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

export function platformLabel(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  return PLATFORMS[v.toLowerCase()] || v;
}

type TrackingRow = Pick<BookingRequest, "utm_source" | "utm_medium" | "utm_campaign" | "utm_content"> &
  Partial<Pick<BookingRequest, "campaign_id" | "adset_id" | "ad_id" | "placement">>;

// null = nothing identified (an untracked visit, or a row from before tracking).
export function leadOrigin(b: TrackingRow | null | undefined): LeadOrigin | null {
  if (!b) return null;
  const s = (v: string | null | undefined) => String(v ?? "").trim();
  const mediumRaw = s(b.utm_medium);
  const o: LeadOrigin = {
    platform: platformLabel(s(b.utm_source)),
    medium: MEDIUMS[mediumRaw.toLowerCase()] || "",
    mediumRaw,
    campaign: s(b.utm_campaign),
    ad: s(b.utm_content),
    campaignId: s(b.campaign_id),
    adsetId: s(b.adset_id),
    adId: s(b.ad_id),
    placement: placementLabel(s(b.placement))
  };
  const any = o.platform || o.mediumRaw || o.campaign || o.ad || o.campaignId || o.adsetId || o.adId || o.placement;
  return any ? o : null;
}
