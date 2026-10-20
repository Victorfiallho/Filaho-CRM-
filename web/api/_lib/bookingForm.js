// Parses and validates a /book/<slug> form submission. Pure: takes the
// parsed form fields and the page config, returns either errors (keyed by
// field, with the typed values echoed back so nothing is lost on re-render)
// or a clean booking object. The handler in ../book.js does the I/O.
import { normalizeEmail, toE164 } from "./consent.js";
import { todayIn, zipToState } from "./usTime.js";
import { parseAnswers } from "./serviceQuestions.js";

export const HEARD_FROM_OPTIONS = [
  "Google", "Facebook or Instagram", "Nextdoor", "Thumbtack", "Yelp",
  "Friend or family", "I'm a returning customer", "Other"
];

export const PERIODS = { morning: "Morning", afternoon: "Afternoon" };

export const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

export const HONEYPOT_FIELD = "website";

const MAX = { name: 60, address: 120, city: 60, notes: 2000, utm: 200 };
const MAX_DAYS_AHEAD = 365;

const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export function activeServices(page) {
  return (page.services || [])
    .filter(s => s && s.active !== false && s.name)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

// "Move-in/Move-out" -> "move-in-move-out": the form value for a service.
export const serviceId = name => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "service";

// The company's CRM services (company_services rows) as the page's list.
export function servicesFromCrm(rows) {
  const seen = new Set();
  return (rows || [])
    .filter(r => r && String(r.service || "").trim())
    .map((r, i) => ({ id: serviceId(r.service), name: String(r.service).trim(), position: r.position ?? i, active: true }))
    .filter(s => (seen.has(s.id) ? false : seen.add(s.id)));
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{ get(name): string|null, getAll(name): string[] }} form  URLSearchParams
 * @param {object} page  booking_pages row
 * @param {Date} [now]
 */
export function parseBookingForm(form, page, now = new Date()) {
  const get = name => form.get(name) ?? "";
  const values = {
    first_name: clip(get("first_name"), MAX.name),
    last_name: clip(get("last_name"), MAX.name),
    phone: clip(get("phone"), 30),
    email: clip(get("email"), 254),
    address: clip(get("address"), MAX.address),
    city: clip(get("city"), MAX.city),
    zip: clip(get("zip"), 10),
    services: form.getAll("services").map(String),
    answers: {},
    preferred_date: clip(get("preferred_date"), 10),
    preferred_period: clip(get("preferred_period"), 20),
    notes: clip(get("notes"), MAX.notes),
    heard_from: clip(get("heard_from"), 60),
    sms_consent: get("sms_consent") === "yes",
    email_consent: get("email_consent") === "yes"
  };
  const errors = {};

  if (!values.first_name) errors.first_name = "Please enter your first name.";
  if (!values.last_name) errors.last_name = "Please enter your last name.";

  const phoneE164 = toE164(values.phone);
  if (!values.phone) errors.phone = "Please enter your mobile number.";
  else if (!phoneE164) errors.phone = "Please enter a valid 10-digit US mobile number.";

  const email = normalizeEmail(values.email);
  if (!values.email) errors.email = "Please enter your email.";
  else if (!email) errors.email = "Please enter a valid email address.";

  // The address is optional; the team gets it when confirming the visit.
  if (values.zip && !/^\d{5}(-\d{4})?$/.test(values.zip)) errors.zip = "Please enter a 5-digit ZIP code.";

  const services = activeServices(page);
  const serviceById = new Map(services.map(s => [String(s.id), s]));
  values.services = values.services.filter(id => serviceById.has(id));
  if (services.length && !values.services.length) errors.services = "Please choose at least one service.";

  // Job questions for the chosen services: all optional, they tell the team
  // how big the job looks before the visit.
  const parsedAnswers = parseAnswers(form, values.services.map(id => serviceById.get(id)));
  values.answers = parsedAnswers.values;
  Object.assign(errors, parsedAnswers.errors);

  const today = todayIn(undefined, now);
  if (values.preferred_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.preferred_date) || Number.isNaN(Date.parse(values.preferred_date))) errors.preferred_date = "Please pick a valid date.";
    else if (values.preferred_date < today) errors.preferred_date = "Please pick today or a later date.";
    else if (values.preferred_date > addDays(today, MAX_DAYS_AHEAD)) errors.preferred_date = "Please pick a date within the next year.";
  }
  if (values.preferred_period && !PERIODS[values.preferred_period]) values.preferred_period = "";
  if (values.heard_from && !HEARD_FROM_OPTIONS.includes(values.heard_from)) values.heard_from = "";

  if (Object.keys(errors).length) return { ok: false, errors, values };

  const utm = Object.fromEntries(UTM_FIELDS.map(f => [f, clip(get(f), MAX.utm)]));
  return {
    ok: true,
    values,
    booking: {
      first_name: values.first_name,
      last_name: values.last_name,
      name: `${values.first_name} ${values.last_name}`,
      phone_e164: phoneE164,
      email,
      address: values.address,
      city: values.city,
      state: zipToState(values.zip) || "",
      zip: values.zip.slice(0, 5),
      services: values.services.map(id => serviceById.get(id).name),
      details: parsedAnswers.answers,
      preferred_date: values.preferred_date || null,
      preferred_period: values.preferred_period || null,
      notes: values.notes,
      heard_from: values.heard_from,
      utm,
      sms_consent: values.sms_consent,
      email_consent: values.email_consent
    }
  };
}
