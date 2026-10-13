// Server-rendered HTML for the public booking page, its two legal pages and
// the small message pages (unsubscribe, not found). Plain template strings —
// the page has to be fast on a phone, indexable, and work with JavaScript
// off, and it must not pull in the CRM bundle (or anything that knows about
// Supabase keys). Every interpolated value goes through esc().
import { HEARD_FROM_OPTIONS, HONEYPOT_FIELD, PERIODS, UTM_FIELDS, activeServices } from "./bookingForm.js";

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// White or near-black text, whichever contrasts more with the brand color —
// the color is admin-chosen, so it can't be assumed dark enough for white.
export function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#fff";
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.05) ? "#ffffff" : "#111827";
}

const safeUrl = url => (/^https:\/\//i.test(String(url || "")) || /^\/[^/]/.test(String(url || "")) ? String(url) : "");
const telHref = phone => `tel:${String(phone || "").replace(/[^\d+]/g, "")}`;
const fullAddress = p => [p.address_line, p.address_city, [p.address_state, p.address_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const money = n => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const jsonLd = obj => JSON.stringify(obj).replace(/</g, "\\u003c");

// The SMS consent text mentions "SMS Terms" and "Privacy Policy" — linked on
// the page, while consent_records.text_shown keeps the plain sentence.
export function linkifyConsent(text, base) {
  return esc(text)
    .replace("SMS Terms", `<a href="${esc(base)}/sms-terms" target="_blank" rel="noopener">SMS Terms</a>`)
    .replace("Privacy Policy", `<a href="${esc(base)}/privacy" target="_blank" rel="noopener">Privacy Policy</a>`);
}

const CSS = `
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#1f2937;background:#ffffff}
a{color:inherit}
img{max-width:100%;height:auto}
.wrap{width:100%;max-width:1040px;margin:0 auto;padding:0 16px}
.skip{position:absolute;left:-9999px}
.skip:focus{left:16px;top:16px;background:#fff;padding:8px 12px;z-index:10;border:2px solid #111827}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;text-decoration:none;color:#111827}
.brand img{height:40px;width:auto}
.phone-link{font-weight:600;text-decoration:none;color:#111827;white-space:nowrap}
.hero{background:var(--brand-soft);padding:40px 0 48px}
.hero h1{font-size:clamp(28px,7vw,44px);line-height:1.15;margin:0 0 12px;color:#111827}
.hero p.lead{font-size:18px;margin:0 0 8px;max-width:640px}
.hero .area{color:#4b5563;margin:0 0 24px}
.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 22px;border-radius:10px;border:0;background:var(--brand);color:var(--on-brand);font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.btn:hover{filter:brightness(1.06)}
.btn.secondary{background:#fff;color:#111827;border:2px solid #111827}
.btn[disabled]{opacity:.6;cursor:progress}
:focus-visible{outline:3px solid #111827;outline-offset:2px}
section.block{padding:40px 0}
section.block.alt{background:#f9fafb}
h2{font-size:clamp(22px,5vw,30px);line-height:1.2;margin:0 0 20px;color:#111827}
.cards{display:grid;gap:14px;grid-template-columns:1fr}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:18px;background:#fff}
.card h3{margin:0 0 6px;font-size:18px;color:#111827}
.card p{margin:0}
.price{margin-top:8px!important;font-weight:600;color:#374151}
ol.steps{list-style:none;margin:0;padding:0;display:grid;gap:14px;counter-reset:s}
ol.steps li{counter-increment:s;display:flex;gap:14px;align-items:flex-start}
ol.steps li::before{content:counter(s);flex:0 0 36px;height:36px;border-radius:50%;background:var(--brand);color:var(--on-brand);display:grid;place-items:center;font-weight:700}
ol.steps b{display:block;color:#111827}
blockquote{margin:0}
.review cite{display:block;margin-top:10px;font-style:normal;font-weight:600;color:#374151}
form .grid{display:grid;gap:14px;grid-template-columns:1fr}
.field{display:grid;gap:6px}
.field label,.legend{font-weight:600;color:#111827}
.req{color:#b91c1c}
.hint{font-size:14px;color:#4b5563}
input[type=text],input[type=tel],input[type=email],input[type=date],input[type=number],select,textarea{width:100%;min-height:48px;padding:10px 12px;font:inherit;color:#111827;background:#fff;border:1px solid #6b7280;border-radius:8px}
textarea{min-height:96px}
[aria-invalid=true]{border-color:#b91c1c;border-width:2px}
.err{color:#b91c1c;font-size:14px;font-weight:600;margin:0}
fieldset{border:0;margin:0;padding:0;min-width:0}
legend{padding:0;margin-bottom:8px}
.checks{display:grid;gap:10px;grid-template-columns:1fr}
.check{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff}
.check input{width:22px;height:22px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--brand)}
.consent .check{font-size:14px;line-height:1.5}
.consent .check label{font-weight:400;color:#1f2937}
.notice{font-size:14px;color:#374151;margin:12px 0 0}
.alert{border:2px solid #b91c1c;background:#fef2f2;border-radius:10px;padding:14px 16px;margin-bottom:18px}
.alert h3{margin:0 0 6px;font-size:17px;color:#7f1d1d}
.alert ul{margin:6px 0 0;padding-left:20px}
.success{border:2px solid #047857;background:#ecfdf5;border-radius:12px;padding:22px}
.success h2{margin-bottom:8px}
.hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
.cities{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:0}
.cities li{padding:6px 12px;border-radius:999px;background:#fff;border:1px solid #e5e7eb}
details{border-bottom:1px solid #e5e7eb;padding:14px 0}
summary{cursor:pointer;font-weight:600;color:#111827;min-height:24px}
details p{margin:10px 0 0}
footer{background:#111827;color:#e5e7eb;padding:32px 0;font-size:15px}
footer a{color:#fff}
footer .links{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px}
.preview-banner{background:#fef3c7;color:#78350f;text-align:center;padding:8px;font-weight:600}
.legal{padding:32px 0 48px;max-width:760px}
.legal h1{font-size:clamp(26px,6vw,36px);margin:0 0 6px;color:#111827}
.legal h2{font-size:20px;margin:28px 0 8px}
@media (min-width:640px){
  .cards{grid-template-columns:repeat(2,1fr)}
  form .grid.two{grid-template-columns:1fr 1fr}
  .checks{grid-template-columns:repeat(2,1fr)}
}
@media (min-width:900px){
  .cards{grid-template-columns:repeat(3,1fr)}
  ol.steps{grid-template-columns:repeat(3,1fr)}
  .hero{padding:64px 0 72px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

function layout({ page, title, description, canonical, body, head = "", preview }) {
  const brand = page?.primary_color || "#f97316";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
${preview ? `<meta name="robots" content="noindex">` : ""}
<meta name="theme-color" content="${esc(brand)}">
<style>:root{--brand:${esc(brand)};--on-brand:${textOn(brand)};--brand-soft:color-mix(in srgb, ${esc(brand)} 10%, #fff)}${CSS}</style>
${head}
</head>
<body>
${preview ? `<div class="preview-banner" role="status">Preview — this form doesn't submit${page && !page.active ? " · page is inactive" : ""}</div>` : ""}
${body}
</body>
</html>`;
}

function topBar(page, base) {
  const logo = safeUrl(page.logo_url);
  return `<header class="wrap top">
  <a class="brand" href="${esc(base)}">${logo ? `<img src="${esc(logo)}" alt="${esc(page.business_name)}" width="120" height="40">` : esc(page.business_name)}</a>
  ${page.phone ? `<a class="phone-link" href="${telHref(page.phone)}">${esc(page.phone)}</a>` : ""}
</header>`;
}

function footer(page, base) {
  const year = new Date().getFullYear();
  return `<footer>
  <div class="wrap">
    <b>${esc(page.business_name)}</b>
    ${fullAddress(page) ? `<address style="font-style:normal">${esc(fullAddress(page))}</address>` : ""}
    <div>${page.phone ? `<a href="${telHref(page.phone)}">${esc(page.phone)}</a>` : ""}${page.phone && page.email ? " · " : ""}${page.email ? `<a href="mailto:${esc(page.email)}">${esc(page.email)}</a>` : ""}</div>
    <nav class="links" aria-label="Legal">
      <a href="${esc(base)}/privacy">Privacy Policy</a>
      <a href="${esc(base)}/sms-terms">SMS Terms</a>
    </nav>
    <p style="margin:12px 0 0">&copy; ${year} ${esc(page.business_name)}</p>
  </div>
</footer>`;
}

function serviceArea(page) {
  const cities = page.service_cities || [];
  if (!cities.length) return "";
  const shown = cities.slice(0, 4).join(", ");
  return cities.length > 4 ? `Serving ${shown} and nearby areas` : `Serving ${shown}`;
}

function field({ name, label, type = "text", required, value, error, attrs = "", hint }) {
  const id = `f_${name}`;
  const describedBy = [hint ? `${id}_hint` : "", error ? `${id}_err` : ""].filter(Boolean).join(" ");
  return `<div class="field">
  <label for="${id}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>
  ${hint ? `<span class="hint" id="${id}_hint">${esc(hint)}</span>` : ""}
  <input id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}"${required ? " required" : ""}${error ? ' aria-invalid="true"' : ""}${describedBy ? ` aria-describedby="${describedBy}"` : ""} ${attrs}>
  ${error ? `<p class="err" id="${id}_err">${esc(error)}</p>` : ""}
</div>`;
}

const FIELD_LABELS = {
  first_name: "First name", last_name: "Last name", phone: "Mobile phone", email: "Email",
  address: "Street address", city: "City", zip: "ZIP code", preferred_date: "Preferred date"
};

function bookingForm({ page, base, texts, values = {}, errors = {}, utm = {}, formError, today, preview }) {
  const services = activeServices(page);
  const selected = new Set(values.services || []);
  const errorList = Object.entries(errors);
  const detailServices = services.filter(s => s.detail_label);

  return `<form method="post" action="${esc(base)}" novalidate id="booking-form"${preview ? ' onsubmit="return false"' : ""}>
  ${formError ? `<div class="alert" role="alert"><h3>We couldn't send your request</h3><p>${esc(formError)} Your answers are still below. You can also call us at ${page.phone ? `<a href="${telHref(page.phone)}">${esc(page.phone)}</a>` : "the number above"}.</p></div>` : ""}
  ${errorList.length ? `<div class="alert" role="alert" tabindex="-1" id="form-errors"><h3>Please fix ${errorList.length === 1 ? "this" : `these ${errorList.length}`} before booking:</h3><ul>${errorList.map(([k, msg]) => `<li><a href="#f_${esc(k)}">${esc(FIELD_LABELS[k] || "This field")}: ${esc(msg)}</a></li>`).join("")}</ul>${page.phone ? `<p style="margin:8px 0 0">Prefer to talk? Call <a href="${telHref(page.phone)}">${esc(page.phone)}</a>.</p>` : ""}</div>` : ""}

  <div class="grid two">
    ${field({ name: "first_name", label: "First name", required: true, value: values.first_name, error: errors.first_name, attrs: 'autocomplete="given-name" maxlength="60"' })}
    ${field({ name: "last_name", label: "Last name", required: true, value: values.last_name, error: errors.last_name, attrs: 'autocomplete="family-name" maxlength="60"' })}
    ${field({ name: "phone", label: "Mobile phone", type: "tel", required: true, value: values.phone, error: errors.phone, hint: "10-digit US number", attrs: 'autocomplete="tel-national" inputmode="tel" maxlength="20"' })}
    ${field({ name: "email", label: "Email", type: "email", required: true, value: values.email, error: errors.email, attrs: 'autocomplete="email" maxlength="254"' })}
  </div>
  <div class="grid" style="margin-top:14px">
    ${field({ name: "address", label: "Street address", required: true, value: values.address, error: errors.address, attrs: 'autocomplete="street-address" maxlength="120"' })}
  </div>
  <div class="grid two" style="margin-top:14px">
    ${field({ name: "city", label: "City", required: true, value: values.city, error: errors.city, attrs: 'autocomplete="address-level2" maxlength="60"' })}
    ${field({ name: "zip", label: "ZIP code", required: true, value: values.zip, error: errors.zip, attrs: 'autocomplete="postal-code" inputmode="numeric" maxlength="10"' })}
  </div>

  ${services.length ? `<fieldset style="margin-top:22px">
    <legend class="legend">What do you need? <span class="hint">(choose any)</span></legend>
    <div class="checks">
      ${services.map(s => `<div class="check"><input type="checkbox" id="svc_${esc(s.id)}" name="services" value="${esc(s.id)}"${selected.has(String(s.id)) ? " checked" : ""}><label for="svc_${esc(s.id)}">${esc(s.name)}</label></div>`).join("")}
    </div>
  </fieldset>` : ""}

  ${detailServices.length ? `<div class="grid two" style="margin-top:14px">
    ${detailServices.map(s => field({ name: `detail_${s.id}`, label: s.detail_label, type: "number", value: values.details?.[s.id], error: errors[`detail_${s.id}`], hint: "Optional", attrs: 'min="0" max="99" step="1" inputmode="numeric"' })).join("")}
  </div>` : ""}

  <div class="grid two" style="margin-top:14px">
    ${field({ name: "preferred_date", label: "Preferred date", type: "date", value: values.preferred_date, error: errors.preferred_date, hint: "Optional — we'll confirm the exact time", attrs: `min="${esc(today)}"` })}
    <div class="field">
      <label for="f_preferred_period">Preferred time of day</label>
      <select id="f_preferred_period" name="preferred_period">
        <option value="">No preference</option>
        ${Object.entries(PERIODS).map(([v, l]) => `<option value="${v}"${values.preferred_period === v ? " selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>
  </div>
  <div class="grid" style="margin-top:14px">
    <div class="field">
      <label for="f_notes">Anything else we should know?</label>
      <textarea id="f_notes" name="notes" maxlength="2000">${esc(values.notes)}</textarea>
    </div>
    <div class="field">
      <label for="f_heard_from">How did you hear about us?</label>
      <select id="f_heard_from" name="heard_from">
        <option value="">Choose one (optional)</option>
        ${HEARD_FROM_OPTIONS.map(o => `<option${values.heard_from === o ? " selected" : ""}>${esc(o)}</option>`).join("")}
      </select>
    </div>
  </div>

  <fieldset class="consent" style="margin-top:22px">
    <legend class="legend">Offers and updates <span class="hint">(optional — not required to book)</span></legend>
    <div class="grid">
      <div class="check"><input type="checkbox" id="sms_consent" name="sms_consent" value="yes"${values.sms_consent ? " checked" : ""}><label for="sms_consent">${linkifyConsent(texts.sms.text, base)}</label></div>
      <div class="check"><input type="checkbox" id="email_consent" name="email_consent" value="yes"${values.email_consent ? " checked" : ""}><label for="email_consent">${esc(texts.email.text)}</label></div>
    </div>
  </fieldset>

  <div class="hp" aria-hidden="true"><label for="f_${HONEYPOT_FIELD}">Leave this empty</label><input id="f_${HONEYPOT_FIELD}" name="${HONEYPOT_FIELD}" type="text" tabindex="-1" autocomplete="off"></div>
  <input type="hidden" name="sms_text_version" value="${esc(texts.sms.version)}">
  <input type="hidden" name="email_text_version" value="${esc(texts.email.version)}">
  <input type="hidden" name="transactional_text_version" value="${esc(texts.transactional.version)}">
  ${UTM_FIELDS.map(f => `<input type="hidden" name="${f}" value="${esc(utm[f])}">`).join("")}

  <div style="margin-top:22px">
    <button class="btn" type="submit" id="submit-btn">Request my appointment</button>
    <p class="notice">${esc(texts.transactional.text)}</p>
  </div>
</form>`;
}

// Progressive enhancement only: instant ZIP feedback and no double submits.
// Everything still works (server-validated) with this script blocked.
export function formScriptBody(page) {
  const prefixes = JSON.stringify((page.zip_prefixes || []).map(String)).replace(/</g, "\\u003c");
  return `
(function(){
  var form=document.getElementById("booking-form");if(!form)return;
  var prefixes=${prefixes};
  var zip=document.getElementById("f_zip");
  function zipMsg(){
    var v=(zip.value||"").trim(),old=document.getElementById("f_zip_live");
    if(old)old.remove();
    if(!/^\\d{5}/.test(v))return;
    var ok=prefixes.some(function(p){return v.indexOf(p)===0});
    zip.setAttribute("aria-invalid",ok?"false":"true");
    if(!ok){var p=document.createElement("p");p.className="err";p.id="f_zip_live";p.setAttribute("role","status");p.textContent="We don't serve this area yet";zip.insertAdjacentElement("afterend",p);}
  }
  zip.addEventListener("blur",zipMsg);
  form.addEventListener("submit",function(){var b=document.getElementById("submit-btn");setTimeout(function(){b.disabled=true;b.textContent="Sending...";},0);});
  var errs=document.getElementById("form-errors");if(errs)errs.focus();
})();
`;
}

// Allowed by a sha256 hash in book.js's CSP rather than a nonce, so the
// page stays CDN-cacheable.
function formScript(page) {
  return `<script>${formScriptBody(page)}</script>`;
}

/**
 * @param {object} o
 * @param {object} o.page   booking_pages row
 * @param {string} o.base   absolute URL of the page, e.g. https://host/book/peach-fresh
 * @param {object} o.texts  { sms|email|transactional: { text, version } } rendered
 */
export function renderBookingPage({ page, base, texts, values, errors, utm, formError, booked, today, preview }) {
  const services = activeServices(page);
  const reviews = (page.reviews || []).filter(r => r && r.text);
  const cities = page.service_cities || [];
  const faq = (page.faq || []).filter(f => f && f.question && f.answer);
  const area = serviceArea(page);

  const ld = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: page.business_name,
    url: base,
    ...(page.phone ? { telephone: page.phone } : {}),
    ...(page.email ? { email: page.email } : {}),
    ...(safeUrl(page.logo_url) && /^https:/i.test(page.logo_url) ? { image: page.logo_url } : {}),
    ...(page.address_line ? {
      address: { "@type": "PostalAddress", streetAddress: page.address_line, addressLocality: page.address_city, addressRegion: page.address_state, postalCode: page.address_zip, addressCountry: "US" }
    } : {}),
    ...(cities.length ? { areaServed: cities.map(name => ({ "@type": "City", name })) } : {}),
    ...(services.length ? { makesOffer: services.map(s => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.name } })) } : {})
  };

  const formSection = booked
    ? `<div class="success" role="status" tabindex="-1" id="booked">
        <h2>Thanks, ${esc(booked)}! We got your request.</h2>
        <p>We'll reach out shortly to confirm your appointment.${page.phone ? ` Need something sooner? Call <a href="${telHref(page.phone)}">${esc(page.phone)}</a>.` : ""}</p>
      </div>`
    : bookingForm({ page, base, texts, values, errors, utm, formError, today, preview });

  const body = `<a class="skip" href="#book">Skip to booking form</a>
${topBar(page, base)}
<main>
  <section class="hero">
    <div class="wrap">
      <h1>${esc(page.hero_title || page.business_name)}</h1>
      ${page.hero_subtitle ? `<p class="lead">${esc(page.hero_subtitle)}</p>` : ""}
      ${area ? `<p class="area">${esc(area)}</p>` : ""}
      <div class="actions">
        <a class="btn" href="#book">Book now</a>
        ${page.phone ? `<a class="btn secondary" href="${telHref(page.phone)}">Call ${esc(page.phone)}</a>` : ""}
      </div>
    </div>
  </section>

  ${services.length ? `<section class="block" aria-labelledby="services-h">
    <div class="wrap">
      <h2 id="services-h">Services</h2>
      <div class="cards">
        ${services.map(s => `<article class="card"><h3>${esc(s.name)}</h3>${s.description ? `<p>${esc(s.description)}</p>` : ""}${s.from_price !== null && s.from_price !== undefined && s.from_price !== "" && Number(s.from_price) > 0 ? `<p class="price">Starting at ${esc(money(s.from_price))}</p>` : ""}</article>`).join("")}
      </div>
    </div>
  </section>` : ""}

  <section class="block alt" aria-labelledby="how-h">
    <div class="wrap">
      <h2 id="how-h">How it works</h2>
      <ol class="steps">
        <li><span><b>Tell us what you need</b>Fill out the short form below — it takes about a minute.</span></li>
        <li><span><b>We confirm your time</b>We'll reach out by text and email to confirm the details.</span></li>
        <li><span><b>We get it done</b>Our team shows up at the confirmed time.</span></li>
      </ol>
    </div>
  </section>

  ${reviews.length ? `<section class="block" aria-labelledby="reviews-h">
    <div class="wrap">
      <h2 id="reviews-h">What customers say</h2>
      <div class="cards">
        ${reviews.map(r => `<figure class="card review" style="margin:0"><blockquote><p>&ldquo;${esc(r.text)}&rdquo;</p></blockquote>${r.author ? `<figcaption><cite>${esc(r.author)}${r.source ? ` · ${esc(r.source)}` : ""}</cite></figcaption>` : ""}</figure>`).join("")}
      </div>
    </div>
  </section>` : ""}

  <section class="block${reviews.length ? " alt" : ""}" id="book" aria-labelledby="book-h">
    <div class="wrap" style="max-width:760px">
      <h2 id="book-h">Book your appointment</h2>
      ${formSection}
    </div>
  </section>

  ${cities.length ? `<section class="block alt" aria-labelledby="cities-h">
    <div class="wrap">
      <h2 id="cities-h">Areas we serve</h2>
      <ul class="cities">${cities.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
    </div>
  </section>` : ""}

  ${faq.length ? `<section class="block" aria-labelledby="faq-h">
    <div class="wrap" style="max-width:760px">
      <h2 id="faq-h">Frequently asked questions</h2>
      ${faq.map(f => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join("")}
    </div>
  </section>` : ""}
</main>
${footer(page, base)}
${booked || preview ? "" : formScript(page)}`;

  return layout({
    page,
    title: page.seo_title || page.business_name,
    description: page.seo_description,
    canonical: base,
    preview,
    head: `<script type="application/ld+json">${jsonLd(ld)}</script>`,
    body
  });
}

function legalPage({ page, base, title, updated, sections, preview }) {
  const body = `${topBar(page, base)}
<main class="wrap legal">
  <h1>${esc(title)}</h1>
  <p class="hint">${esc(page.business_name)}${updated ? ` · Last updated ${esc(updated)}` : ""}</p>
  ${sections.map(([h, html]) => `<h2>${esc(h)}</h2>${html}`).join("\n")}
  <p style="margin-top:32px"><a href="${esc(base)}">&larr; Back to booking</a></p>
</main>
${footer(page, base)}`;
  return layout({ page, title: `${title} | ${page.business_name}`, canonical: `${base}${title === "Privacy Policy" ? "/privacy" : "/sms-terms"}`, preview, body });
}

function contactHtml(page) {
  return `<p>${esc(page.business_name)}<br>${esc(fullAddress(page))}<br>${page.phone ? `Phone: <a href="${telHref(page.phone)}">${esc(page.phone)}</a><br>` : ""}${page.email ? `Email: <a href="mailto:${esc(page.email)}">${esc(page.email)}</a>` : ""}</p>`;
}

const updatedOn = page => (page.updated_at ? new Date(page.updated_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" }) : "");

export function renderSmsTermsPage({ page, base, preview }) {
  const name = esc(page.business_name);
  const phone = page.phone ? `<a href="${telHref(page.phone)}">${esc(page.phone)}</a>` : "";
  return legalPage({
    page, base, preview, title: "SMS Terms", updated: updatedOn(page),
    sections: [
      ["Program", `<p><b>${name} Text Messages.</b> When you book with us, we send text messages about your appointment: confirmations, reminders, and updates. If you separately opt in on our booking form, we also send marketing and promotional messages such as offers and seasonal reminders.</p>
       <p>Consent to marketing texts is not a condition of purchase.</p>`],
      ["Message frequency", `<p>Message frequency varies.</p>`],
      ["Cost", `<p>Msg &amp; data rates may apply.</p>`],
      ["How to opt out", `<p>Reply <b>STOP</b> to any message to stop receiving texts from us. You can also reply STOPALL, UNSUBSCRIBE, CANCEL, END or QUIT. We'll send one message confirming you've been unsubscribed, and no further marketing messages after that.</p>`],
      ["Help", `<p>Reply <b>HELP</b> to any message for help, or contact us${phone ? ` at ${phone}` : ""}${page.email ? `${phone ? " or" : " at"} <a href="mailto:${esc(page.email)}">${esc(page.email)}</a>` : ""}.</p>`],
      ["Privacy", `<p>Mobile information will not be shared with third parties or affiliates for marketing/promotional purposes. See our <a href="${esc(base)}/privacy">Privacy Policy</a> for details.</p>`],
      ["Carriers", `<p>Carriers are not liable for delayed or undelivered messages.</p>`],
      ["Support", contactHtml(page)]
    ]
  });
}

export function renderPrivacyPage({ page, base, preview }) {
  const name = esc(page.business_name);
  return legalPage({
    page, base, preview, title: "Privacy Policy", updated: updatedOn(page),
    sections: [
      ["Who we are", `<p>${name} provides home services in the areas listed on our booking page. This policy explains what information we collect when you book with us or contact us, and how we use it.</p>`],
      ["Information we collect", `<ul>
        <li>Contact details you give us: name, mobile phone number, email, and service address.</li>
        <li>Details about the service you request: services, sizes or quantities, preferred date and time, notes, and how you heard about us.</li>
        <li>Your choices about marketing messages, including the exact wording you agreed to and when.</li>
        <li>Technical information sent by your browser when you submit the form: IP address, browser type, and the page and campaign link you came from.</li>
      </ul>`],
      ["How we use it", `<ul>
        <li>To schedule and provide the service you asked for, and to contact you about it (confirmations, reminders, and updates).</li>
        <li>To send marketing texts or emails only if you opted in to them, and to honor your opt-out at any time.</li>
        <li>To keep records of your consent choices, prevent spam and abuse, and meet our legal obligations.</li>
      </ul>`],
      ["Text messages", `<p>Mobile information will not be shared with third parties or affiliates for marketing/promotional purposes. Reply STOP to any text to opt out. See our <a href="${esc(base)}/sms-terms">SMS Terms</a>.</p>`],
      ["Email", `<p>Every marketing email includes an unsubscribe link that works with one click.</p>`],
      ["Sharing", `<p>We do not sell your personal information. We share it only with service providers that help us run our business (for example, hosting, scheduling, and message delivery) under agreements that limit their use of it, or when required by law.</p>`],
      ["Retention", `<p>We keep your information for as long as we need it to serve you and for our records. Records of consent and opt-out requests are kept as long as needed to show we honored your choices.</p>`],
      ["Your choices", `<p>You can ask us to access, correct, or delete your information by contacting us below. You can opt out of marketing at any time without affecting appointment messages about a booking you made.</p>`],
      ["Security", `<p>We use reasonable safeguards to protect your information. No method of transmission over the internet is completely secure.</p>`],
      ["Children", `<p>Our services and this website are not directed to children under 13, and we do not knowingly collect their information.</p>`],
      ["Changes", `<p>If we change this policy we'll post the new version here with a new "last updated" date.</p>`],
      ["Contact us", contactHtml(page)]
    ]
  });
}

export function renderMessagePage({ title, message, page, form }) {
  const body = `<main class="wrap legal" style="padding-top:48px">
  ${page?.business_name ? `<p class="hint">${esc(page.business_name)}</p>` : ""}
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
  ${form || ""}
</main>`;
  return layout({ page, title, body });
}
