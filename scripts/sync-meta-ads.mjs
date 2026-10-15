// Daily Meta Ads sync (.github/workflows/sync-meta-ads.yml). For every
// company with an ad account in integration_settings.meta_ads, pulls
// yesterday's spend, impressions and clicks per campaign into
// meta_ads_insights (Reports). Read-only against Meta.
//
// BACKFILL_DAYS=N (the workflow's manual "days" input) loads the last N days
// instead, one row per campaign per day; re-running is safe (upsert).

const META_ACCESS_TOKEN = requireEnv("META_ACCESS_TOKEN");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const META_API_VERSION = "v21.0";
const BACKFILL_DAYS = Math.min(Math.max(Number(process.env.BACKFILL_DAYS) || 1, 1), 365);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  return v;
}

async function supabaseRequest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const isoDay = d => d.toISOString().slice(0, 10);

// One row per campaign per day (time_increment=1), following Meta's paging.
async function fetchInsights(adAccountId, since, until) {
  const fields = "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc";
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  let url = `https://graph.facebook.com/${META_API_VERSION}/${adAccountId}/insights?level=campaign&time_increment=1&time_range=${timeRange}&limit=500&fields=${fields}&access_token=${META_ACCESS_TOKEN}`;
  const rows = [];
  while (url) {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || `Meta Graph API request failed: ${res.status}`);
    rows.push(...(body.data || []));
    url = body.paging?.next || null;
  }
  return rows;
}

async function main() {
  const [settingsRow] = await supabaseRequest("integration_settings?id=eq.default&select=settings");
  const metaAds = settingsRow?.settings?.meta_ads;
  if (!metaAds?.enabled) {
    console.log("meta_ads integration not enabled. Skipping.");
    return;
  }
  const accounts = Object.entries(metaAds.ad_account_ids || {}).filter(([, id]) => id);
  if (!accounts.length) {
    console.log("No ad_account_ids configured for any company. Nothing to sync.");
    return;
  }

  const until = new Date();
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - (BACKFILL_DAYS - 1));
  const range = [isoDay(since), isoDay(until)];

  for (const [companyId, adAccountId] of accounts) {
    console.log(`Fetching insights for ${companyId} (${adAccountId})...`);
    const insights = await fetchInsights(adAccountId, ...range);
    const rows = insights.map(row => ({
      company_id: companyId,
      date: row.date_start,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name || null,
      spend: row.spend != null ? Number(row.spend) : null,
      impressions: row.impressions != null ? Number(row.impressions) : null,
      clicks: row.clicks != null ? Number(row.clicks) : null,
      ctr: row.ctr != null ? Number(row.ctr) : null,
      cpc: row.cpc != null ? Number(row.cpc) : null,
      synced_at: new Date().toISOString()
    }));
    console.log(`Upserting ${rows.length} campaign-day row(s) for ${companyId}, ${range[0]} to ${range[1]}...`);
    for (const batch of chunk(rows, 500)) {
      if (!batch.length) continue;
      await supabaseRequest("meta_ads_insights?on_conflict=company_id,campaign_id,date", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(batch)
      });
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
