import { supabase } from "../lib/supabaseClient";
import type { CampaignRoi } from "../domain/types";

// Backed by get_campaign_roi() (supabase/migrations/2026-08-31_03_campaign_roi.sql).
// Only leads tagged with a campaign_id show up broken out by campaign — revenue
// from untagged leads/jobs comes back as a single "Não atribuído" row instead
// of being guessed at.
export async function getCampaignRoi(companyId: string, dateFrom: string, dateTo: string): Promise<CampaignRoi[]> {
  const { data, error } = await supabase.rpc("get_campaign_roi", {
    p_company_id: companyId,
    p_date_from: dateFrom,
    p_date_to: dateTo
  });
  if (error) throw error;
  return (data || []) as CampaignRoi[];
}
