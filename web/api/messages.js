// Messages with a client, from the CRM:
//
//   GET  /api/messages?company_id=<id>                  which channels are set up
//   GET  /api/messages?company_id=<id>&sync=<client id> copy that client's Gmail emails in
//   POST /api/messages                                  { company_id, customer_id, channel: "sms"|"email", subject?, body }
//   GET  /api/messages?cron=1  (x-cron-secret header)   Gmail sync for every company (.github/workflows/sync-gmail.yml)
//
// The caller must be a member of the company and the client must belong to
// it; the address comes from the client record, never from the request, so
// this can't message arbitrary people. SMS to a number that replied STOP is
// refused (carriers block it anyway). Email goes through the company's own
// Gmail when connected (Resend otherwise). Every attempt is stored in
// `messages`, failures included, so the thread shows what really went out.
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { accountEmail, buildRaw, googleAccess, hasGmail, sendGmail, syncGmail } from "./_lib/gmail.js";
import { query } from "./_lib/http.js";
import {
  EMAIL_MAX, SMS_MAX, SUBJECT_MAX, clientAddress, emailConfigured, loadIdentity, sendEmail, sendSms, smsConfigured, uid
} from "./_lib/messaging.js";

// Per person, to stop a stuck loop or a leaked session from mass texting.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;

function cronAllowed(given) {
  const expected = process.env.MESSAGES_CRON_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const params = query(req);

  if (req.method === "GET" && params.get("cron") === "1") {
    if (!cronAllowed(req.headers["x-cron-secret"])) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const supabase = db();
    const { data: rows } = await supabase.from("google_oauth_tokens").select("company_id, scope");
    const results = {};
    for (const row of (rows || []).filter(r => hasGmail(r.scope))) {
      try {
        results[row.company_id] = (await syncGmail(supabase, row.company_id)).synced;
      } catch (err) {
        console.error("gmail sync failed", row.company_id, err);
        results[row.company_id] = "error";
      }
    }
    res.status(200).json({ ok: true, results });
    return;
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const supabase = db();
  try {
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }
    const userId = userData.user.id;
    const input = req.method === "GET" ? Object.fromEntries(params) : req.body || {};
    const companyId = typeof input.company_id === "string" ? input.company_id : "";

    const { data: member } = await supabase.from("company_members").select("company_id")
      .eq("user_id", userId).eq("company_id", companyId).maybeSingle();
    if (!member) {
      res.status(403).json({ error: "Not a member of this company." });
      return;
    }

    const identity = await loadIdentity(supabase, companyId);

    if (req.method === "GET" && input.sync) {
      const { data: client } = await supabase.from("customers").select("id, email")
        .eq("id", String(input.sync)).eq("company_id", companyId).maybeSingle();
      if (!client) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      res.status(200).json(identity.gmail ? await syncGmail(supabase, companyId, { customer: client }) : { synced: 0, connected: false });
      return;
    }
    if (req.method === "GET") {
      res.status(200).json({
        sms: smsConfigured(identity),
        email: emailConfigured(identity),
        email_via: identity.gmail ? "gmail" : emailConfigured(identity) ? "resend" : null,
        email_account: identity.gmail ? identity.gmail_account : identity.email_from
      });
      return;
    }

    const channel = input.channel;
    const body = typeof input.body === "string" ? input.body.trim() : "";
    let subject = typeof input.subject === "string" ? input.subject.trim().slice(0, SUBJECT_MAX) : "";
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

    const row = { id: uid("msg"), company_id: companyId, customer_id: customer.id, channel, direction: "out", to_addr: to, body, sent_by: userId };
    try {
      if (channel === "sms") {
        row.from_addr = identity.sms_from;
        row.provider_id = await sendSms({ to, from: identity.sms_from, body });
      } else if (identity.gmail) {
        const access = await googleAccess(supabase, companyId);
        const from = await accountEmail(supabase, companyId, access);
        // Answer inside the client's existing Gmail thread, which needs
        // the same subject.
        const { data: last } = await supabase.from("messages").select("subject, provider_thread_id")
          .eq("company_id", companyId).eq("customer_id", customer.id).eq("channel", "email")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const threadId = !subject && last?.provider_thread_id ? last.provider_thread_id : null;
        if (!subject) subject = threadId && last.subject ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : identity.company_name || "Message";
        const sent = await sendGmail({ token: access.token, raw: buildRaw({ fromName: identity.company_name, fromEmail: from, to, subject, body }), threadId });
        Object.assign(row, { from_addr: from, provider_id: sent.id, provider_thread_id: sent.threadId });
      } else {
        subject = subject || identity.company_name || "Message";
        row.from_addr = identity.email_from;
        row.provider_id = await sendEmail({ to, from: identity.email_from, replyTo: identity.email_reply_to, subject, body });
      }
      row.status = "sent";
    } catch (err) {
      row.status = "failed";
      row.error = String(err.message || err).slice(0, 500);
    }
    row.subject = channel === "email" ? subject : "";

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
