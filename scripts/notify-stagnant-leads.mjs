// Daily stagnant-deal email (.github/workflows/notify-stagnant-leads.yml).
// For each company, get_stagnant_leads() with the service_role key (sees
// every company); if any come back, emails the company's owners and admins
// through Resend (internal users have no phone on file).
//
// No dedupe on purpose: a deal still stuck tomorrow is emailed again.

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = process.env.RESEND_API_KEY;

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

async function main() {
  const [settingsRow] = await supabase("integration_settings?id=eq.default&select=settings");
  const emailSms = settingsRow?.settings?.email_sms;
  if (!emailSms?.enabled) {
    console.log("email_sms integration not enabled. Skipping.");
    return;
  }

  const companies = await supabase("companies?select=id,name");
  let notified = 0;

  for (const company of companies) {
    const stagnant = await supabase(`rpc/get_stagnant_leads`, {
      method: "POST",
      body: JSON.stringify({ p_company_id: company.id })
    });
    if (!stagnant?.length) continue;

    const members = await supabase(
      `company_members?company_id=eq.${company.id}&role=in.(owner,admin)&select=user_id`
    );
    const authUserIds = [...new Set(members.map(m => m.user_id))];
    if (!authUserIds.length) {
      console.log(`${company.name}: ${stagnant.length} stagnant lead(s), but no owner/admin to notify.`);
      continue;
    }
    const recipients = await supabase(
      `users?auth_user_id=in.(${authUserIds.join(",")})&select=email,name`
    );

    const lines = stagnant
      .slice(0, 20)
      .map(l => `- ${l.name}: ${Math.floor(l.days_in_stage)} day(s) in "${l.stage_id}" (est. $${Math.round(l.value || 0).toLocaleString("en-US")})`)
      .join("\n");
    const body = `${stagnant.length} lead(s) at ${company.name} haven't moved stage in a while:\n\n${lines}${stagnant.length > 20 ? "\n\n(and more)" : ""}`;

    for (const recipient of recipients) {
      if (!recipient.email) continue;
      try {
        await sendEmail(recipient.email, `${company.name}: ${stagnant.length} stalled lead(s)`, body, emailSms.from_email);
        notified++;
      } catch (err) {
        console.error(`Failed to notify ${recipient.email} for ${company.name}:`, err.message);
      }
    }
  }
  console.log(`Sent ${notified} stagnant-lead notification(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
