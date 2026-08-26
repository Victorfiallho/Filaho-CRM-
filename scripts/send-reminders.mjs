// Daily job-reminder send. Run by .github/workflows/send-reminders.yml
// (schedule + manual dispatch), same requireEnv/supabase-fetch pattern as
// sync-google-calendar.mjs. For every job scheduled tomorrow, looks up its
// linked customer's phone/email and sends a reminder via Twilio (SMS,
// preferred if a phone is on file) or Resend (email, fallback) — the same
// two providers web/api/send-notification.js uses for the on-demand
// "Send reminder now" button, just called directly here instead of over
// HTTP since this already runs with full service-role DB access.
//
// No dedupe column exists yet for "already reminded this job" — acceptable
// for a once-a-day cron (see Filaho-CRM- MVP plan), but note this would
// double-send if the workflow were ever triggered twice for the same day.

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  return v;
}

function supabase(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...init.headers
    }
  }).then(async res => {
    if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  });
}

async function sendEmail(to, subject, body, fromEmail) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: fromEmail || "notifications@filaho.com", to: [to], subject, text: body })
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
}

async function sendSms(to, body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) throw new Error("Twilio env vars not configured");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body })
  });
  if (!res.ok) throw new Error(`Twilio failed: ${res.status} ${await res.text()}`);
}

function tomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const [settingsRow] = await supabase("integration_settings?id=eq.default&select=settings");
  const emailSms = settingsRow?.settings?.email_sms;
  if (!emailSms?.enabled) {
    console.log("email_sms integration not enabled — skipping.");
    return;
  }

  const tomorrow = tomorrowDateString();
  const jobs = await supabase(`jobs?scheduled_date=eq.${tomorrow}&select=id,title,customer_id,company_id,scheduled_date`);
  console.log(`${jobs.length} job(s) scheduled for ${tomorrow}.`);

  let sent = 0, failed = 0;
  for (const job of jobs) {
    if (!job.customer_id) continue;
    const [customer] = await supabase(`customers?id=eq.${job.customer_id}&select=name,phone,email`);
    if (!customer) continue;
    const body = `Reminder: ${job.title} is scheduled tomorrow (${job.scheduled_date}). Reply if you need to reschedule.`;
    try {
      if (customer.phone) {
        await sendSms(customer.phone, body);
      } else if (customer.email) {
        await sendEmail(customer.email, "Appointment reminder", body, emailSms.from_email);
      } else {
        continue;
      }
      sent++;
    } catch (err) {
      failed++;
      console.error(`Failed to remind ${customer.name} for job ${job.id}:`, err.message);
    }
  }
  console.log(`Sent ${sent} reminder(s), ${failed} failed.`);
}

main().catch(err => { console.error(err); process.exit(1); });
