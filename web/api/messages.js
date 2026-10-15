// Messages with a client, from the CRM:
//
//   GET  /api/messages?company_id=<id>   which channels are set up
//   POST /api/messages                   { company_id, customer_id, channel: "sms"|"email", subject?, body }
//
// The caller must be a member of the company and the client must belong to
// it; the address comes from the client record, never from the request, so
// this can't message arbitrary people. SMS to a number that replied STOP is
// refused (carriers block it anyway). Every attempt is stored in `messages`,
// failures included, so the thread shows what really went out.
import { createClient } from "@supabase/supabase-js";
import { query } from "./_lib/http.js";
import {
  EMAIL_MAX, SMS_MAX, SUBJECT_MAX, clientAddress, emailConfigured, loadIdentity, sendEmail, sendSms, smsConfigured, uid
} from "./_lib/messaging.js";

// Per person, to stop a stuck loop or a leaked session from mass texting.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }
    const userId = userData.user.id;
    const input = req.method === "GET" ? Object.fromEntries(query(req)) : req.body || {};
    const companyId = typeof input.company_id === "string" ? input.company_id : "";

    const { data: member } = await supabase.from("company_members").select("company_id")
      .eq("user_id", userId).eq("company_id", companyId).maybeSingle();
    if (!member) {
      res.status(403).json({ error: "Not a member of this company." });
      return;
    }

    const identity = await loadIdentity(supabase, companyId);
    if (req.method === "GET") {
      res.status(200).json({ sms: smsConfigured(identity), email: emailConfigured(identity) });
      return;
    }

    const channel = input.channel;
    const body = typeof input.body === "string" ? input.body.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject.trim().slice(0, SUBJECT_MAX) : "";
    if (channel !== "sms" && channel !== "email") {
      res.status(400).json({ error: "channel must be 'sms' or 'email'." });
      return;
    }
    if (!body || body.length > (channel === "sms" ? SMS_MAX : EMAIL_MAX)) {
      res.status(400).json({ error: channel === "sms" ? `Write 1 to ${SMS_MAX} characters.` : `Write 1 to ${EMAIL_MAX} characters.` });
      return;
    }
    if (channel === "sms" ? !smsConfigured(identity) : !emailConfigured(identity)) {
      res.status(503).json({ error: channel === "sms" ? "SMS isn't set up yet." : "Email isn't set up yet.", code: "not_configured" });
      return;
    }

    const { data: customer } = await supabase.from("customers").select("id, name, phone, phone_e164, email")
      .eq("id", String(input.customer_id || "")).eq("company_id", companyId).maybeSingle();
    if (!customer) {
      res.status(404).json({ error: "Client not found." });
      return;
    }
    const to = clientAddress(customer, channel);
    if (!to) {
      res.status(422).json({ error: channel === "sms" ? "This client has no valid US phone number." : "This client has no valid email." });
      return;
    }
    if (channel === "sms") {
      const { data: stopped } = await supabase.from("suppression_list").select("value").eq("channel", "sms").eq("value", to).maybeSingle();
      if (stopped) {
        res.status(409).json({ error: "This number replied STOP. It can't receive texts until they text START.", code: "opted_out" });
        return;
      }
    }

    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count } = await supabase.from("messages").select("id", { count: "exact", head: true })
      .eq("sent_by", userId).gte("created_at", since);
    if ((count || 0) >= RATE_LIMIT) {
      res.status(429).json({ error: "Too many messages in a minute. Wait a moment." });
      return;
    }

    const from = channel === "sms" ? identity.sms_from : identity.email_from;
    const emailSubject = subject || identity.company_name || "Message";
    const row = {
      id: uid("msg"), company_id: companyId, customer_id: customer.id, channel, direction: "out",
      to_addr: to, from_addr: from, subject: channel === "email" ? emailSubject : "", body, sent_by: userId
    };
    try {
      row.provider_id = channel === "sms"
        ? await sendSms({ to, from, body })
        : await sendEmail({ to, from, replyTo: identity.email_reply_to, subject: emailSubject, body });
      row.status = "sent";
    } catch (err) {
      row.status = "failed";
      row.error = String(err.message || err).slice(0, 500);
    }

    const { data: saved, error: saveError } = await supabase.from("messages").insert(row).select().single();
    if (saveError) throw saveError;
    if (row.status === "failed") {
      res.status(502).json({ error: row.error, message: saved });
      return;
    }
    res.status(200).json({ message: saved });
  } catch (err) {
    console.error("messages failed", err);
    res.status(500).json({ error: "Could not send the message." });
  }
}
