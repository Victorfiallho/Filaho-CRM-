// Vercel serverless function (web/api/* is Vercel's zero-config function
// folder for this project's Root Directory) — on-demand email/SMS send,
// backing Integrations.tsx's "Email & SMS" card and RecordModal's "Send
// reminder now" button. The daily automated reminder job is a separate
// script (scripts/send-reminders.mjs run via GitHub Actions cron), not this
// endpoint — this one is purely request/response, triggered by the app.
//
// SECURITY (2026-08-26 fix): this endpoint originally had no authentication
// at all — any anonymous internet caller could POST here and make the app's
// real, paid Resend/Twilio accounts send arbitrary email/SMS to any address,
// spoofed as coming from the company's own verified sending domain/number
// (confirmed exploitable in a security audit before this was ever
// committed). It now requires a valid Supabase session and only sends to a
// `to` that matches a real customer or lead contact in a company the caller
// is a member of.
//
// Needs RESEND_API_KEY (email) and/or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/
// TWILIO_FROM_NUMBER (SMS) set in the Vercel project — not VITE_-prefixed, so
// they never ship to the client bundle, same convention as
// GOOGLE_CLIENT_SECRET in api/google-oauth-callback.js.
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

    // Only send to a `to` that matches a real contact in a company the
    // caller belongs to — closes the open-relay abuse path while still
    // allowing the legitimate "remind this job's customer" flow.
    const matchColumn = type === "sms" ? "phone" : "email";
    const [{ data: customerMatch }, { data: leadMatch }] = await Promise.all([
      supabase.from("customers").select("id").in("company_id", companyIds).eq(matchColumn, to).limit(1),
      supabase.from("leads").select("id").in("company_id", companyIds).eq(matchColumn, to).limit(1)
    ]);
    if (!customerMatch?.length && !leadMatch?.length) {
      res.status(403).json({ error: "Recipient is not a known contact for your company." });
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
