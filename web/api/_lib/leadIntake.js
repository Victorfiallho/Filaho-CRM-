// Pure helpers for POST /api/lead-intake: turn whatever an automation tool
// sends (Zapier/Make "Facebook Lead Ads", a website form, ...) into one lead.
// Field names vary by tool, so each CRM field accepts several spellings,
// Meta's own (full_name, phone_number, zip_code) included.
import { normalizeEmail, toE164 } from "./consent.js";

const FIELD_NAMES = {
  name: ["name", "full_name", "fullname", "nome"],
  first_name: ["first_name", "firstname"],
  last_name: ["last_name", "lastname"],
  phone: ["phone", "phone_number", "telefone", "mobile"],
  email: ["email", "email_address"],
  address: ["address", "street_address", "street"],
  city: ["city", "cidade"],
  state: ["state", "province", "estado"],
  zip: ["zip", "zip_code", "zipcode", "post_code", "postal_code", "cep"],
  service: ["service", "service_type", "servico"],
  notes: ["notes", "message", "comments", "observacoes"],
  campaign_id: ["campaign_id"],
  campaign_name: ["campaign_name", "campaign"],
  source: ["source", "lead_source", "platform"]
};

// Ids and plumbing a tool may forward that mean nothing to the sales team.
const IGNORED = new Set([
  "company", "key", "id", "lead_id", "leadgen_id", "form_id", "page_id", "ad_id", "adset_id", "created_time",
  "is_organic", "ad_name", "adset_name", "form_name"
]);

const normField = k => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const clip = (v, n = 200) => String(v ?? "").trim().slice(0, n);

// `params` is a URLSearchParams (form or flattened JSON body).
export function parseLeadPayload(params) {
  const fields = new Map();
  for (const [k, v] of params) if (String(v).trim()) fields.set(normField(k), String(v));
  const pick = field => {
    for (const name of FIELD_NAMES[field]) if (fields.has(name)) return fields.get(name);
    return "";
  };

  const name = clip(pick("name") || [pick("first_name"), pick("last_name")].filter(Boolean).join(" "), 120);
  const phone = clip(pick("phone"), 40);
  const email = normalizeEmail(pick("email")) || "";

  // Answers to the form's own questions ("What's your budget?") become a note
  // instead of being dropped.
  const known = new Set(Object.values(FIELD_NAMES).flat());
  const extras = [...fields]
    .filter(([k]) => !known.has(k) && !IGNORED.has(k))
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${clip(v, 500)}`);

  return {
    name: name || (email ? email.split("@")[0] : ""),
    phone,
    phone_e164: toE164(phone),
    email,
    address: clip(pick("address")),
    city: clip(pick("city"), 80),
    state: clip(pick("state"), 40),
    zip: (pick("zip").match(/\d{5}/) || [""])[0],
    service: clip(pick("service"), 120),
    notes: [clip(pick("notes"), 2000), ...extras].filter(Boolean).join("\n"),
    campaign_id: clip(pick("campaign_id"), 64) || null,
    campaign_name: clip(pick("campaign_name"), 200) || null,
    source: clip(pick("source"), 60) || "Meta Ads"
  };
}

export function leadIsUsable(lead) {
  return Boolean(lead.name && (lead.phone_e164 || lead.email));
}

const lastTen = v => String(v || "").replace(/\D/g, "").slice(-10);

// Same person = same phone (last 10 digits) or same email, like the booking page.
export function findClient(clients, lead) {
  const digits = lead.phone_e164 ? lastTen(lead.phone_e164) : "";
  return clients.find(c =>
    (digits && (c.phone_e164 === lead.phone_e164 || lastTen(c.phone) === digits)) ||
    (lead.email && String(c.email || "").trim().toLowerCase() === lead.email)
  ) || null;
}

// The company's own service name when the text matches one, else "".
export function matchService(text, services) {
  const key = String(text || "").trim().toLowerCase();
  if (!key) return "";
  return services.find(s => s.toLowerCase() === key) || services.find(s => key.includes(s.toLowerCase()) || s.toLowerCase().includes(key)) || "";
}

// "new" when the company has it, else its first open stage.
export function intakeStage(stages) {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  return ordered.find(s => s.id === "new")?.id
    || ordered.find(s => s.type !== "won" && s.type !== "lost")?.id
    || ordered[0]?.id
    || "new";
}
