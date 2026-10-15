// Shared pieces of the Messages feature: provider calls (Twilio SMS, Resend
// email), each company's sending identity, and which company/client an
// inbound SMS belongs to.
import { normalizeEmail, toE164 } from "./consent.js";

export const SMS_MAX = 1600;
export const EMAIL_MAX = 10000;
export const SUBJECT_MAX = 200;

export const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function smsConfigured(identity) {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && identity.sms_from);
}

export function emailConfigured(identity) {
  return Boolean(process.env.RESEND_API_KEY && identity.email_from);
}

// The company's row in company_messaging, with env fallbacks. reply_to
// falls back to the booking page email so replies reach a real inbox.
export async function loadIdentity(supabase, companyId) {
  const [{ data: row }, { data: page }, { data: company }] = await Promise.all([
    supabase.from("company_messaging").select("sms_from, email_from, email_reply_to").eq("company_id", companyId).maybeSingle(),
    supabase.from("booking_pages").select("email").eq("company_id", companyId).maybeSingle(),
    supabase.from("companies").select("name").eq("id", companyId).maybeSingle()
  ]);
  return {
    company_name: company?.name || "",
    sms_from: row?.sms_from || process.env.TWILIO_FROM_NUMBER || "",
    email_from: row?.email_from || process.env.RESEND_FROM_EMAIL || "",
    email_reply_to: row?.email_reply_to || page?.email || ""
  };
}

// Where a message to this client goes on each channel, or "" if none.
export function clientAddress(customer, channel) {
  if (channel === "sms") return customer.phone_e164 || toE164(customer.phone) || "";
  return normalizeEmail(customer.email) || "";
}

export async function sendSms({ to, from, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ To: to, From: from, Body: body })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Twilio request failed (${res.status}).`);
  return json.sid || null;
}

export async function sendEmail({ to, from, replyTo, subject, body }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text: body, ...(replyTo ? { reply_to: replyTo } : {}) })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Resend request failed (${res.status}).`);
  return json.id || null;
}

const lastTen = v => String(v || "").replace(/\D/g, "").slice(-10);

// The company an inbound SMS belongs to: the one whose number it was sent
// to, else the one that last texted this person, else the only company that
// has them as a client. Null when it can't be told apart.
export async function routeInboundSms(supabase, { from, to }) {
  const { data: byNumber } = await supabase.from("company_messaging").select("company_id").eq("sms_from", to).limit(2);
  let companyId = byNumber?.length === 1 ? byNumber[0].company_id : null;

  if (!companyId) {
    const { data: lastOut } = await supabase.from("messages").select("company_id")
      .eq("channel", "sms").eq("direction", "out").eq("to_addr", from)
      .order("created_at", { ascending: false }).limit(1);
    companyId = lastOut?.[0]?.company_id || null;
  }

  const clientsQuery = supabase.from("customers").select("id, company_id, phone, phone_e164");
  const { data: clients } = companyId ? await clientsQuery.eq("company_id", companyId) : await clientsQuery;
  const digits = lastTen(from);
  const matches = (clients || []).filter(c => c.phone_e164 === from || (digits && lastTen(c.phone) === digits));

  if (!companyId) {
    const companies = [...new Set(matches.map(c => c.company_id))];
    if (companies.length !== 1) return null;
    companyId = companies[0];
  }
  const client = matches.find(c => c.company_id === companyId) || null;
  return { companyId, customerId: client?.id || null };
}

// Stores an inbound SMS in its client's thread and puts it in the activity
// feed. Texts that can't be tied to a company are dropped (and logged).
export async function recordInboundSms(supabase, { from, to, body, sid }) {
  const route = await routeInboundSms(supabase, { from, to });
  if (!route) {
    console.warn("sms-inbound: no company for", from);
    return null;
  }
  const id = uid("msg");
  const { error } = await supabase.from("messages").insert({
    id, company_id: route.companyId, customer_id: route.customerId, channel: "sms", direction: "in",
    to_addr: to || "", from_addr: from, body: body || "", status: "received", provider_id: sid || null
  });
  if (error) throw error;

  let name = from;
  if (route.customerId) {
    const { data: client } = await supabase.from("customers").select("name").eq("id", route.customerId).maybeSingle();
    name = client?.name || from;
  }
  const { error: auditError } = await supabase.from("audit_log").insert({
    company_id: route.companyId, user_id: null, entity: "messages", entity_id: id, action: "insert",
    diff: { name, channel: "sms", customer_id: route.customerId, preview: String(body || "").slice(0, 80) }
  });
  if (auditError) console.error("sms-inbound: activity entry failed", auditError);
  return { id, ...route };
}
