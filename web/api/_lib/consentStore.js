// DB side of consent.js — loads what canSendMarketing() needs, and the
// current consent texts for a page. Takes a service_role supabase client.
import { canSendMarketing, contactValue, renderConsentText } from "./consent.js";

export const CONSENT_KINDS = ["sms", "email", "transactional"];

// { sms: {version, template}, email: ..., transactional: ... } — latest of each.
export async function loadLatestConsentTexts(supabase, companyId) {
  const { data, error } = await supabase
    .from("consent_text_versions")
    .select("kind, version, template")
    .eq("company_id", companyId)
    .order("version", { ascending: false });
  if (error) throw error;
  const latest = {};
  for (const row of data || []) if (!latest[row.kind]) latest[row.kind] = row;
  for (const kind of CONSENT_KINDS) if (!latest[kind]) throw new Error(`No ${kind} consent text published for ${companyId}.`);
  return latest;
}

export async function loadConsentTextVersion(supabase, companyId, kind, version) {
  if (!Number.isInteger(version) || version < 1) return null;
  const { data, error } = await supabase
    .from("consent_text_versions")
    .select("kind, version, template")
    .eq("company_id", companyId)
    .eq("kind", kind)
    .eq("version", version)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function renderTexts(versions, businessName) {
  return Object.fromEntries(
    Object.entries(versions).map(([kind, v]) => [kind, { version: v.version, text: renderConsentText(v.template, businessName) }])
  );
}

// The one call every future marketing send goes through:
//   const verdict = await checkCanSendMarketing(supabase, customerId, "sms");
//   if (!verdict.allowed) skip(verdict.reason);
export async function checkCanSendMarketing(supabase, customerId, channel, now = new Date()) {
  const { data: contact, error } = await supabase
    .from("customers")
    .select("id, company_id, phone, phone_e164, email, state, zip")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw error;
  if (!contact) return { allowed: false, reason: "no_contact_value", message: "Contact not found." };

  const value = contactValue(contact, channel);
  const [consents, suppressed] = await Promise.all([
    supabase.from("consent_records").select("channel, purpose, granted, created_at").eq("contact_id", customerId).eq("channel", channel),
    value ? supabase.from("suppression_list").select("value").eq("channel", channel).eq("value", value) : Promise.resolve({ data: [] })
  ]);
  if (consents.error) throw consents.error;
  if (suppressed.error) throw suppressed.error;

  return canSendMarketing(contact, channel, {
    consents: consents.data || [],
    suppressed: (suppressed.data || []).map(r => r.value),
    now
  });
}
