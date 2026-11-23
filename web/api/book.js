// The public booking page, no login. vercel.json rewrites:
//
//   GET  /book/<slug>            the page
//   GET  /book/<slug>/privacy    privacy policy
//   GET  /book/<slug>/sms-terms  SMS terms
//   POST /book/<slug>            submit, then 303 to ?booked=<first name>&r=<request id>
//
// Every company has a page (migration 12), built from the company and its
// CRM services. Rendered server-side (_lib/bookingHtml.js): fast, indexable,
// works without JavaScript, and never ships a key. Uses the service_role key
// because anon can't read the booking and consent tables.
//
// submit_booking() writes everything in one transaction: the client (new, or
// matched by phone/email), one deal per service, the booking request, both
// consent records (granted or not) and the activity feed entry. IP, user
// agent and timestamps come from the server, never from the form.
//
// Abuse: a honeypot field (bots get a fake success) and RATE_LIMIT bookings
// per IP per RATE_WINDOW_MS, counted from booking_requests.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { HONEYPOT_FIELD, parseBookingForm, servicesFromCrm } from "./_lib/bookingForm.js";
import { hasTracking, readTracking } from "./_lib/attribution.js";
import { AB_TEST, assignVariant, isBot, isVariant, readCookie } from "./_lib/abTest.js";
import { LEAD_EVENT_ID, headScriptBody, formScriptBody, pixelScriptBody, renderBookingPage, renderMessagePage, renderPrivacyPage, renderSmsTermsPage } from "./_lib/bookingHtml.js";
import { loadConsentTextVersion, loadLatestConsentTexts, renderTexts } from "./_lib/consentStore.js";
import { clientIp, origin, query, readForm, sendHtml, userAgent } from "./_lib/http.js";
import { todayIn } from "./_lib/usTime.js";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
// How long after the booking its success view may still report the Lead.
const LEAD_WINDOW_MS = 30 * 60 * 1000;

const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const formatUsPhone = e164 => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

const sha = body => `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

function csp(withScript, pixel = "") {
  const scripts = [
    ...(withScript ? [sha(headScriptBody()), sha(formScriptBody())] : []),
    ...(pixel ? [sha(pixel), "https://connect.facebook.net"] : [])
  ];
  return [
    "default-src 'none'",
    "img-src 'self' https: data:",
    "media-src 'self'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    `script-src ${scripts.join(" ") || "'none'"}`,
    ...(pixel ? ["connect-src https://www.facebook.com https://connect.facebook.net"] : []),
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'self'"
  ].join("; ");
}

function notFound(res) {
  sendHtml(res, 404, renderMessagePage({ title: "Page not found", message: "This booking page doesn't exist." }), { "cache-control": "no-store" });
}

// The page row plus what the system already knows about the company. The
// row's own business_name/primary_color are only fallbacks.
async function loadPage(supabase, slug) {
  const { data: row, error } = await supabase.from("booking_pages").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const [company, services] = await Promise.all([
    supabase.from("companies").select("id, name, color").eq("id", row.company_id).maybeSingle(),
    supabase.from("company_services").select("service, position").eq("company_id", row.company_id).order("position")
  ]);
  if (company.error) throw company.error;
  if (services.error) throw services.error;
  return {
    ...row,
    business_name: company.data?.name || row.business_name,
    primary_color: /^#[0-9a-f]{6}$/i.test(company.data?.color || "") ? company.data.color : row.primary_color,
    services: servicesFromCrm(services.data)
  };
}

// The ?r= on a success view, if it names a booking this company saved in the
// last LEAD_WINDOW_MS: that's the Lead to report. Anything else (no r, a typed
// URL, the honeypot's fake success, an old link) gets the page without it.
async function confirmedLead(supabase, companyId, requestId) {
  const id = String(requestId || "");
  if (!LEAD_EVENT_ID.test(id)) return "";
  const { data, error } = await supabase.from("booking_requests").select("id, created_at").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (error || !data) return "";
  return Date.now() - Date.parse(data.created_at) <= LEAD_WINDOW_MS ? data.id : "";
}

// One more visit of this page and variant today (booking_page_views). A
// failed count must never cost the visitor the page.
async function countView(supabase, slug, variant) {
  try {
    const { error } = await supabase.rpc("count_booking_view", { p_slug: slug, p_variant: variant });
    if (error) console.error("count_booking_view failed", error);
  } catch (err) {
    console.error("count_booking_view failed", err);
  }
}

function render(res, status, { page, base, texts, extra = {}, cache = "no-store" }) {
  const html = renderBookingPage({ page, base, texts, today: todayIn(), ...extra });
  sendHtml(res, status, html, { "cache-control": cache, "content-security-policy": csp(!extra.booked, pixelScriptBody(page.slug, !!extra.booked, extra.leadEventId)) });
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).end();
    return;
  }
  const params = query(req);
  const slug = String(params.get("slug") || "").toLowerCase();
  const subpage = params.get("page") || "";
  if (!slug) return notFound(res);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const page = await loadPage(supabase, slug);
    if (!page) return notFound(res);

    const base = `${origin(req)}/book/${page.slug}`;
    const cache = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

    if (req.method === "GET" && subpage) {
      const html = subpage === "privacy" ? renderPrivacyPage({ page, base })
        : subpage === "sms-terms" ? renderSmsTermsPage({ page, base })
        : null;
      if (!html) return notFound(res);
      sendHtml(res, 200, html, { "cache-control": cache, "content-security-policy": csp(false) });
      return;
    }

    const texts = renderTexts(await loadLatestConsentTexts(supabase, page.company_id), page.business_name);

    if (req.method === "GET") {
      const booked = params.get("booked");
      if (booked) {
        const leadEventId = await confirmedLead(supabase, page.company_id, params.get("r"));
        return render(res, 200, { page, base, texts, extra: { booked: booked.slice(0, 60), leadEventId } });
      }
      const utm = readTracking(params);
      // While the A/B test runs the page can't be cached: the CDN would hand
      // one visitor's variant to everyone.
      const { variant, setCookie } = assignVariant({ cookieHeader: req.headers?.cookie, forced: params.get("ab") });
      if (setCookie) res.setHeader("set-cookie", setCookie);
      if (variant && !isBot(userAgent(req))) await countView(supabase, page.slug, variant);
      return render(res, 200, { page, base, texts, extra: { utm, variant }, cache: hasTracking(utm) || variant ? "no-store" : cache });
    }

    // ── POST: a booking ───────────────────────────────────────────────────
    const form = await readForm(req);
    const firstName = String(form.get("first_name") || "").trim().slice(0, 60);
    // requestId only when submit_booking saved it: the success view reports the Lead for it.
    const success = (name, requestId = "") => {
      res.statusCode = 303;
      res.setHeader("location", `${base}?booked=${encodeURIComponent(name || "there")}${requestId ? `&r=${encodeURIComponent(requestId)}` : ""}#booked`);
      res.setHeader("cache-control", "no-store");
      res.end();
    };

    if (String(form.get(HONEYPOT_FIELD) || "").trim()) return success(firstName);

    const utm = readTracking(form);
    // The variant the visitor saw: the form's hidden field, else the cookie.
    const posted = String(form.get("ab_variant") || "");
    const cookieVariant = readCookie(req.headers?.cookie, AB_TEST.cookie);
    const variant = isVariant(posted) ? posted : isVariant(cookieVariant) ? cookieVariant : "";
    const ip = clientIp(req);
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count, error: countError } = await supabase
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    if (countError) throw countError;

    const parsed = parseBookingForm(form, page);
    if ((count || 0) >= RATE_LIMIT) {
      return render(res, 429, { page, base, texts, extra: { values: parsed.values, utm, variant, formError: "We've received several requests from your network in the last few minutes. Please wait a bit and try again." } });
    }
    if (!parsed.ok) {
      return render(res, 422, { page, base, texts, extra: { values: parsed.values, errors: parsed.errors, utm, variant } });
    }

    // Record the exact wording the visitor saw: the versions in the form's
    // hidden fields, or the latest if those don't exist. Never a mix.
    const shownVersion = async kind => {
      const v = await loadConsentTextVersion(supabase, page.company_id, kind, Number(form.get(`${kind}_text_version`)));
      return v ? { version: v.version, text: renderTexts({ [kind]: v }, page.business_name)[kind].text } : texts[kind];
    };
    const [smsText, emailText] = await Promise.all([shownVersion("sms"), shownVersion("email")]);

    const b = parsed.booking;
    const pageUrl = base;
    const payload = {
      company_id: page.company_id,
      customer_id: uid("cust"),
      lead_id: uid("lead"),
      request_id: uid("book"),
      name: b.name,
      phone: formatUsPhone(b.phone_e164),
      phone_e164: b.phone_e164,
      email: b.email,
      address: b.address,
      city: b.city,
      state: b.state,
      zip: b.zip,
      services: b.services,
      details: b.details,
      preferred_date: b.preferred_date,
      preferred_period: b.preferred_period,
      notes: b.notes,
      heard_from: b.heard_from,
      utm,
      ab_variant: variant,
      page_url: pageUrl,
      ip,
      user_agent: userAgent(req),
      consents: [
        { channel: "sms", value: b.phone_e164, granted: b.sms_consent, text_shown: smsText.text, text_version: smsText.version },
        { channel: "email", value: b.email, granted: b.email_consent, text_shown: emailText.text, text_version: emailText.version }
      ]
    };

    const { error: submitError } = await supabase.rpc("submit_booking", { p: payload });
    if (submitError) {
      console.error("submit_booking failed", submitError);
      return render(res, 500, { page, base, texts, extra: { values: parsed.values, utm, variant, formError: "Something went wrong on our side and your request wasn't saved." } });
    }
    return success(b.first_name, payload.request_id);
  } catch (err) {
    console.error("book handler failed", err);
    sendHtml(res, 500, renderMessagePage({ title: "Something went wrong", message: "We couldn't load this page. Please try again in a moment." }), { "cache-control": "no-store" });
  }
}
