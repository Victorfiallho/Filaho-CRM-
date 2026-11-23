// Where a booking came from: the ad link's tracking parameters.
//
// Meta ads link to /book/<slug>?utm_source=ig&utm_medium=paid_social
// &utm_campaign=...&utm_content=<ad name>&campaign_id=...&adset_id=...
// &ad_id=...&placement=Instagram_Reels. The page keeps the last identified
// entry of the session (see bookingClient in bookingHtml.js) and posts it
// with the form; this module cleans what arrives, in both places.
//
// IDs stay text: Meta IDs are 15-20 digits, past what a JS number holds
// exactly (120000000000003 survives, 120212345678901234 would not).

export const TRACKING_FIELDS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "campaign_id", "adset_id", "ad_id", "placement"
];

const ID_FIELDS = new Set(["campaign_id", "adset_id", "ad_id"]);
const MAX_TEXT = 200;
const MAX_ID = 30;

// One value: trimmed, control characters out, length capped. An ID that isn't
// all digits (an unfilled "{{ad.id}}" macro, junk) is dropped rather than kept
// half-right.
export function cleanTrackingValue(field, value) {
  const v = String(value ?? "").replace(/\p{Cc}/gu, "").trim();
  if (ID_FIELDS.has(field)) return v.length <= MAX_ID && /^\d+$/.test(v) ? v : "";
  return v.slice(0, MAX_TEXT);
}

// Every field, "" when absent. `source` is anything with get(name):
// URLSearchParams from the query string or the posted form.
export function readTracking(source) {
  return Object.fromEntries(TRACKING_FIELDS.map(f => [f, cleanTrackingValue(f, source.get(f))]));
}

export const hasTracking = t => TRACKING_FIELDS.some(f => t[f]);
