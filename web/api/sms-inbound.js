// Inbound SMS. Point the Twilio number's webhook at
// POST /api/sms-inbound?key=<SMS_INBOUND_SECRET>. Reads Twilio-style fields
// (From, To, Body, MessageSid) as a form or JSON, answers in TwiML.
//
// Every text is stored in the client's conversation (Messages, see
// _lib/messaging.js recordInboundSms) and shows in the activity feed.
//
// STOP-type replies (see classifyInboundSms) call revoke_marketing_consent():
// the number is suppressed everywhere, and each client with it gets a
// granted=false consent record holding the exact reply. HELP/INFO gets a help
// reply; anything else gets nothing.
//
// The shared secret is the only gate until the provider's signature check is
// added here. Without SMS_INBOUND_SECRET every request is refused.
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { classifyInboundSms, toE164 } from "./_lib/consent.js";
import { query, readForm } from "./_lib/http.js";
import { recordInboundSms } from "./_lib/messaging.js";

const xml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

function twiml(res, message) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/xml; charset=utf-8");
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${xml(message)}</Message>` : ""}</Response>`);
}

function secretMatches(given) {
  const expected = process.env.SMS_INBOUND_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The business the reply went to, matched by its booking page phone. Null
// when unknown, and the replies stay generic.
async function businessFor(supabase, to) {
  const e164 = toE164(to);
  if (!e164) return null;
  const { data } = await supabase.from("booking_pages").select("company_id, business_name, phone, email");
  return (data || []).find(p => toE164(p.phone) === e164) || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!secretMatches(query(req).get("key") || req.headers["x-inbound-secret"])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const form = await readForm(req);
  const from = toE164(form.get("From") || form.get("from"));
  const body = String(form.get("Body") || form.get("body") || "").slice(0, 1600);
  const kind = classifyInboundSms(body);
  if (!from) return twiml(res, null);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    // Every text goes into the client's conversation (Messages), STOP and
    // HELP included, so staff see exactly what the client sent.
    await recordInboundSms(supabase, {
      from, to: toE164(form.get("To") || form.get("to")), body, sid: form.get("MessageSid") || form.get("SmsSid") || null
    });
    if (!kind) return twiml(res, null);

    const business = await businessFor(supabase, form.get("To") || form.get("to"));
    if (kind === "help") {
      const contact = [business?.phone, business?.email].filter(Boolean).join(" or ");
      return twiml(res, `${business?.business_name || "Help"}: for help${contact ? ` call/email ${contact}` : ", reply to this message"}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`);
    }

    const { error } = await supabase.rpc("revoke_marketing_consent", {
      p_channel: "sms",
      p_value: from,
      p_reason: "stop_reply",
      p_source: "inbound_stop",
      p_text: `Inbound SMS reply: "${body.trim()}"`,
      p_company_id: business?.company_id || null
    });
    if (error) throw error;
    return twiml(res, `You're unsubscribed from ${business?.business_name || "our"} marketing texts. No more marketing messages will be sent.`);
  } catch (err) {
    // A 500 makes the provider retry, which an unrecorded opt-out needs.
    console.error("sms-inbound failed", err);
    res.status(500).json({ error: "Could not process the message." });
  }
}
