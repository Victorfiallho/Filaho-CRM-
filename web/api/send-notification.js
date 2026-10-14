// Sends one email or SMS on demand: the Integrations test send and "Send
// reminder now" on a job. Daily reminders are scripts/send-reminders.mjs.
//
// Requires a session and only sends to a contact of one of the caller's
// companies that has existed for at least MIN_CONTACT_AGE_MS, so it can't be
// used to message arbitrary people, even by creating a contact right before.
const MIN_CONTACT_AGE_MS = 5 * 60 * 1000;
// Env (server only): RESEND_API_KEY for email; TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER for SMS.
import { createClient } from "@supabase/supabase-js";

async function sendEmail(to, subject, body, fromEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured on the server.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [to], subject, text: body })
  });
  if (!res.ok) throw new Error(`Resend request failed: ${res.status} ${await res.text()}`);
}

async function sendSms(to, body, fromPhone) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !authToken) throw new Error("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not configured on the server.");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ To: to, From: fromPhone, Body: body })
  });
  if (!res.ok) throw new Error(`Twilio request failed: ${res.status} ${await res.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const { type, to, subject, body, from_email: fromEmail, from_phone: fromPhone } = req.body || {};
  if (!type || !to || !body) {
    res.status(400).json({ error: "Missing type, to, or body." });
    return;
  }
  if (type !== "email" && type !== "sms") {
    res.status(400).json({ error: "type must be 'email' or 'sms'." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }

    const { data: memberRows } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userData.user.id);
    const companyIds = (memberRows || []).map(r => r.company_id);
    if (!companyIds.length) {
      res.status(403).json({ error: "No company membership." });
      return;
    }

    // A real contact of the caller's company, older than MIN_CONTACT_AGE_MS.
    const matchColumn = type === "sms" ? "phone" : "email";
    const cutoff = new Date(Date.now() - MIN_CONTACT_AGE_MS).toISOString();
    const [{ data: customerMatch }, { data: leadMatch }] = await Promise.all([
      supabase.from("customers").select("id").in("company_id", companyIds).eq(matchColumn, to).lt("created_at", cutoff).limit(1),
      supabase.from("leads").select("id").in("company_id", companyIds).eq(matchColumn, to).lt("created_at", cutoff).limit(1)
    ]);
    if (!customerMatch?.length && !leadMatch?.length) {
      res.status(403).json({ error: "Recipient is not a known, established contact for your company." });
      return;
    }

    if (type === "email") {
      await sendEmail(to, subject || "Filaho CRM", body, fromEmail || "notifications@filaho.com");
    } else {
      await sendSms(to, body, fromPhone || process.env.TWILIO_FROM_NUMBER);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
