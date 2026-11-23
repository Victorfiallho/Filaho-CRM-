// The booking page's A/B test: "a" is the page as it was, "b" puts the form
// right under the title and asks for contact details in step 2.
//
// Each visitor is assigned once and keeps the variant for 30 days (cookie),
// so a returning visitor sees the same page. ?ab=a|b forces one (for QA) and
// sticks it. Views are counted per day/page/variant (book.js) and each
// booking stores its variant, which is what booking_ab_results compares.
// To stop the test, set ACTIVE to false: everyone gets "a" again and the
// page goes back to being cached.

export const AB_TEST = { id: "form-first", active: true, cookie: "fhi_ab", maxAgeDays: 30 };
const VARIANTS = new Set(["a", "b"]);

export const isVariant = v => VARIANTS.has(String(v || ""));

export function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

/**
 * @returns {{ variant: string, setCookie: string | null }} variant "" when the test is off.
 */
export function assignVariant({ cookieHeader, forced, random = Math.random }) {
  if (!AB_TEST.active) return { variant: "", setCookie: null };
  const saved = readCookie(cookieHeader, AB_TEST.cookie);
  const variant = isVariant(forced) ? forced : isVariant(saved) ? saved : random() < 0.5 ? "a" : "b";
  const setCookie = variant === saved ? null
    : `${AB_TEST.cookie}=${variant}; Path=/book; Max-Age=${AB_TEST.maxAgeDays * 86400}; SameSite=Lax; Secure; HttpOnly`;
  return { variant, setCookie };
}

// Link previews, crawlers, uptime checks and scripts don't count as visits.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|meta-external|preview|headless|lighthouse|pingdom|uptime|monitor|python|curl|wget|go-http|java\/|okhttp|axios|node-fetch|httpclient|scrapy|ahrefs|semrush|bingpreview/i;
export const isBot = userAgent => !userAgent || BOT_UA.test(userAgent);
