// Background Google Calendar sync. Run by
// .github/workflows/sync-google-calendar.yml (schedule + manual dispatch).
// For every company with a stored refresh token (web/api/google-oauth-
// callback.js put it there), mints a fresh access token and reconciles that
// company's scheduled jobs against real events on their Google Calendar —
// no browser tab needs to be open, unlike the old popup-only OAuth flow.
//
// Every event this script creates is tagged with a private extended
// property (crm_job_id) so it can find its own events again on the next
// run, and so it never touches events a human added to the same calendar by
// hand. All-day events, same shape as the existing ICS export
// (web/src/domain/calendarExport.ts) — jobs only ever store a date, not a
// time of day.

const GOOGLE_CLIENT_SECRET = requireEnv("GOOGLE_CLIENT_SECRET");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

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

async function getClientId() {
  const [row] = await supabase("integration_settings?id=eq.default&select=settings");
  const clientId = row?.settings?.google_oauth?.client_id;
  if (!clientId) throw new Error("No Google OAuth client_id in integration_settings — nothing to refresh against.");
  return clientId;
}

async function refreshAccessToken(clientId, refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.error || "Token refresh failed");
  return body.access_token;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function jobToEvent(job, companyName) {
  return {
    summary: `${companyName}: ${job.title}`,
    location: [job.address, job.city, job.state, job.zip].filter(Boolean).join(", "),
    description: `Service: ${job.service_type || ""}\nStatus: ${job.status || ""}\nCRM job id: ${job.id}`,
    start: { date: job.scheduled_date },
    end: { date: addDays(job.scheduled_date, 1) },
    extendedProperties: { private: { fialho_crm: "1", crm_job_id: job.id } }
  };
}

function eventChanged(existing, desired) {
  // Google omits `location`/`description` entirely from the response when
  // they're empty, rather than returning "" — normalize both sides so a job
  // with no address doesn't look "changed" on every single run.
  return existing.summary !== desired.summary
    || (existing.location || "") !== desired.location
    || existing.start?.date !== desired.start.date
    || existing.end?.date !== desired.end.date;
}

async function calendarRequest(accessToken, calendarId, path, init = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init.headers }
  });
  if (!res.ok) throw new Error(`Calendar API ${init.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function listTaggedEvents(accessToken, calendarId) {
  const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const events = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      privateExtendedProperty: "fialho_crm=1",
      timeMin, timeMax, maxResults: "2500", showDeleted: "false"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await calendarRequest(accessToken, calendarId, `/events?${params.toString()}`);
    events.push(...(page.items || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return events;
}

async function syncCompany(clientId, tokenRow) {
  const companyId = tokenRow.company_id;
  console.log(`\n--- ${companyId} ---`);

  const accessToken = await refreshAccessToken(clientId, tokenRow.refresh_token);

  const [company] = await supabase(`companies?id=eq.${companyId}&select=name`);
  const [settingsRow] = await supabase("integration_settings?id=eq.default&select=settings");
  const calendarId = settingsRow?.settings?.google_calendar?.calendar_ids?.[companyId] || "primary";

  const jobs = await supabase(`jobs?company_id=eq.${companyId}&scheduled_date=not.is.null&select=id,title,status,service_type,address,city,state,zip,scheduled_date,google_event_id`);
  const jobsById = new Map(jobs.map(j => [j.id, j]));

  const existingEvents = await listTaggedEvents(accessToken, calendarId);
  const eventsByJobId = new Map(
    existingEvents.map(e => [e.extendedProperties?.private?.crm_job_id, e]).filter(([id]) => id)
  );

  let created = 0, updated = 0, deleted = 0;

  for (const job of jobs) {
    const desired = jobToEvent(job, company?.name || companyId);
    const existing = eventsByJobId.get(job.id);
    if (!existing) {
      const event = await calendarRequest(accessToken, calendarId, "/events", { method: "POST", body: JSON.stringify(desired) });
      await supabase(`jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ google_event_id: event.id }) });
      created++;
    } else if (eventChanged(existing, desired)) {
      console.log("DEBUG diff", job.id, JSON.stringify({ existingSummary: existing.summary, desiredSummary: desired.summary, existingLocation: existing.location, desiredLocation: desired.location, existingStart: existing.start, desiredStart: desired.start, existingEnd: existing.end, desiredEnd: desired.end }));
      await calendarRequest(accessToken, calendarId, `/events/${existing.id}`, { method: "PATCH", body: JSON.stringify(desired) });
      updated++;
    }
  }

  // Any tagged event whose crm_job_id isn't in this company's currently-
  // scheduled jobs means the job was deleted or unscheduled since the last
  // run — remove the stale event (jobsById only contains scheduled jobs).
  for (const [jobId, event] of eventsByJobId) {
    if (jobsById.has(jobId)) continue;
    await calendarRequest(accessToken, calendarId, `/events/${event.id}`, { method: "DELETE" });
    deleted++;
  }

  console.log(`${companyId}: ${created} created, ${updated} updated, ${deleted} deleted`);
}

async function main() {
  const tokenRows = await supabase("google_oauth_tokens?select=company_id,refresh_token");
  if (!tokenRows.length) { console.log("No companies have connected Google Calendar yet."); return; }

  const clientId = await getClientId();
  let failures = 0;
  for (const row of tokenRows) {
    try {
      await syncCompany(clientId, row);
    } catch (err) {
      failures++;
      console.error(`Failed to sync ${row.company_id}:`, err.message);
    }
  }
  if (failures === tokenRows.length) process.exit(1); // every company failed — treat as a broken run
}

main().catch(err => { console.error(err); process.exit(1); });
