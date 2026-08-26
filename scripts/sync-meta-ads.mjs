// Daily Meta Ads performance sync. Run by .github/workflows/sync-meta-ads.yml
// (schedule + manual dispatch), same requireEnv/supabaseRequest/chunk pattern
// as scrape-muses.mjs. For every company with an ad_account_id configured in
// integration_settings.meta_ads, pulls yesterday's per-campaign spend/
// impressions/clicks from the Marketing API and upserts into
// meta_ads_insights (read by Reports.tsx via data/metaAds.ts). Read-only
// against Meta — this never writes anything back to Meta Ads Manager.

const META_ACCESS_TOKEN = requireEnv("META_ACCESS_TOKEN");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const META_API_VERSION = "v21.0";

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

async function fetchInsights(adAccountId) {
  const fields = "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc";
  const url = `https://graph.facebook.com/${META_API_VERSION}/${adAccountId}/insights?level=campaign&date_preset=yesterday&fields=${fields}&access_token=${META_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || `Meta Graph API request failed: ${res.status}`);
  return body.data || [];
}

async function main() {
  const [settingsRow] = await supabaseRequest("integration_settings?id=eq.default&select=settings");
  const metaAds = settingsRow?.settings?.meta_ads;
  if (!metaAds?.enabled) {
    console.log("meta_ads integration not enabled — skipping.");
    return;
  }
  const accounts = Object.entries(metaAds.ad_account_ids || {}).filter(([, id]) => id);
  if (!accounts.length) {
    console.log("No ad_account_ids configured for any company — nothing to sync.");
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().slice(0, 10);

  for (const [companyId, adAccountId] of accounts) {
    console.log(`Fetching insights for ${companyId} (${adAccountId})...`);
    const insights = await fetchInsights(adAccountId);
    const rows = insights.map(row => ({
      company_id: companyId,
      date,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name || null,
      spend: row.spend != null ? Number(row.spend) : null,
      impressions: row.impressions != null ? Number(row.impressions) : null,
      clicks: row.clicks != null ? Number(row.clicks) : null,
      ctr: row.ctr != null ? Number(row.ctr) : null,
      cpc: row.cpc != null ? Number(row.cpc) : null,
      synced_at: new Date().toISOString()
    }));
    console.log(`Upserting ${rows.length} campaign row(s) for ${companyId} on ${date}...`);
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
