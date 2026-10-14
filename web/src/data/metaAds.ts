import { supabase } from "../lib/supabaseClient";

export interface MetaAdInsight {
  id: string;
  company_id: string;
  date: string;
  campaign_id: string;
  campaign_name: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  synced_at: string;
}

// Read-only: scripts/sync-meta-ads.mjs writes these rows. The last 30 days
// is what the Reports ad summary needs.
export async function listMetaAdsInsights(companyId: string): Promise<MetaAdInsight[]> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data, error } = await supabase
    .from("meta_ads_insights")
    .select("*")
    .eq("company_id", companyId)
    .gte("date", since.toISOString().slice(0, 10))
    .order("date", { ascending: false });
  if (error) throw error;
  return data || [];
}
