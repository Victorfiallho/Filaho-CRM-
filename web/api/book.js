// Vercel serverless function — the public booking page, no login.
//
//   GET  /book/<slug>             page (vercel.json rewrites to ?slug=<slug>)
//   GET  /book/<slug>/privacy     privacy policy   (&page=privacy)
//   GET  /book/<slug>/sms-terms   SMS terms        (&page=sms-terms)
//   POST /book/<slug>             form submit → 303 back to ?booked=<first name>
//   GET  /api/book?company=<id>&preview=1&page=...   admin preview (Bearer token,
//        must be a member of that company; works for inactive pages too)
//
// Server-rendered HTML (api/_lib/bookingHtml.js), so it's indexable, fast on
// a phone, works with JavaScript off, and never ships the CRM bundle or any
// key to the visitor. Uses the service_role key server-side only: anon has
// no RLS policy on any booking/consent table.
//
// What a submit writes, all inside submit_booking() (one transaction):
// client (new, or the existing one with the same phone/email), a new lead in
// the "new" stage, the booking_request, two consent_records (sms + email,
// granted true OR false — always both), and an audit_log row for the
// Dashboard feed. IP, user agent and timestamps are taken here/in Postgres,
// never from the form.
//
// Abuse: a honeypot field (bots that fill it get a fake success) and a
// per-IP limit of RATE_LIMIT bookings per RATE_WINDOW_MS, counted from
// booking_requests itself so it needs no extra store.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { HONEYPOT_FIELD, UTM_FIELDS, parseBookingForm } from "./_lib/bookingForm.js";
import { formScriptBody, renderBookingPage, renderMessagePage, renderPrivacyPage, renderSmsTermsPage } from "./_lib/bookingHtml.js";
import { loadConsentTextVersion, loadLatestConsentTexts, renderTexts } from "./_lib/consentStore.js";
import { clientIp, origin, query, readForm, sendHtml, userAgent } from "./_lib/http.js";
import { todayIn } from "./_lib/usTime.js";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const formatUsPhone = e164 => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

function csp(page, withScript) {
  const scriptHash = withScript ? `'sha256-${createHash("sha256").update(formScriptBody(page)).digest("base64")}'` : "'none'";
  return [
    "default-src 'none'",
    "img-src 'self' https: data:",
    "style-src 'unsafe-inline'",
    `script-src ${scriptHash}`,
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'self'"
  ].join("; ");
}

function notFound(res) {
  sendHtml(res, 404, renderMessagePage({ title: "Page not found", message: "This booking page doesn't exist or isn't available right now." }), { "cache-control": "no-store" });
}

async function loadPage(supabase, { slug, companyId }) {
  let q = supabase.from("booking_pages").select("*");
  q = companyId ? q.eq("company_id", companyId) : q.eq("slug", slug);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function isMember(supabase, req, companyId) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return false;
  const { data } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", userData.user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  return Boolean(data);
}

function render(res, status, { page, base, texts, extra = {}, cache = "no-store", preview = false }) {
  const html = renderBookingPage({ page, base, texts, today: todayIn(), preview, ...extra });
  const withScript = !extra.booked && !preview;
  sendHtml(res, status, html, { "cache-control": cache, "content-security-policy": csp(page, withScript) });
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
  const previewCompany = params.get("preview") === "1" ? String(params.get("company") || "") : "";
  if (!slug && !previewCompany) return notFound(res);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const page = await loadPage(supabase, previewCompany ? { companyId: previewCompany } : { slug });
    if (!page) return notFound(res);

    const preview = Boolean(previewCompany);
    if (preview) {
      if (req.method !== "GET" || !(await isMember(supabase, req, page.company_id))) {
        res.status(401).json({ error: "Sign in to preview this page." });
        return;
      }
    } else if (!page.active) {
      return notFound(res);
    }

    const base = `${origin(req)}/book/${page.slug}`;
    const cache = preview ? "no-store" : "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

    if (req.method === "GET" && subpage) {
      const html = subpage === "privacy" ? renderPrivacyPage({ page, base, preview })
        : subpage === "sms-terms" ? renderSmsTermsPage({ page, base, preview })
        : null;
      if (!html) return notFound(res);
      sendHtml(res, 200, html, { "cache-control": cache, "content-security-policy": csp(page, false) });
      return;
    }

    const texts = renderTexts(await loadLatestConsentTexts(supabase, page.company_id), page.business_name);

    if (req.method === "GET") {
      const booked = params.get("booked");
      if (booked) return render(res, 200, { page, base, texts, extra: { booked: booked.slice(0, 60) } });
      const utm = Object.fromEntries(UTM_FIELDS.map(f => [f, String(params.get(f) || "").slice(0, 200)]));
      const hasUtm = UTM_FIELDS.some(f => utm[f]);
      return render(res, 200, { page, base, texts, extra: { utm }, cache: hasUtm || preview ? "no-store" : cache, preview });
    }

    // ── POST: a booking ───────────────────────────────────────────────────
    const form = await readForm(req);
    const firstName = String(form.get("first_name") || "").trim().slice(0, 60);
    const success = name => {
      res.statusCode = 303;
      res.setHeader("location", `${base}?booked=${encodeURIComponent(name || "there")}#booked`);
      res.setHeader("cache-control", "no-store");
      res.end();
    };

    if (String(form.get(HONEYPOT_FIELD) || "").trim()) return success(firstName);

    const utm = Object.fromEntries(UTM_FIELDS.map(f => [f, String(form.get(f) || "").slice(0, 200)]));
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
      return render(res, 429, { page, base, texts, extra: { values: parsed.values, utm, formError: "We've received several requests from your network in the last few minutes. Please wait a bit and try again." } });
    }
    if (!parsed.ok) {
      return render(res, 422, { page, base, texts, extra: { values: parsed.values, errors: parsed.errors, utm } });
    }

    // Record the exact wording the visitor saw: the versions the form was
    // rendered with (hidden fields), falling back to the latest if those
    // don't exist (stale/tampered form) — never a mix.
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
      return render(res, 500, { page, base, texts, extra: { values: parsed.values, utm, formError: "Something went wrong on our side and your request wasn't saved." } });
    }
    return success(b.first_name);
  } catch (err) {
    console.error("book handler failed", err);
    sendHtml(res, 500, renderMessagePage({ title: "Something went wrong", message: "We couldn't load this page. Please try again in a moment." }), { "cache-control": "no-store" });
  }
}
