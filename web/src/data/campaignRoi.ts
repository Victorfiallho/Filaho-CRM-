import { supabase } from "../lib/supabaseClient";
import type { CampaignRoi } from "../domain/types";

// get_campaign_roi() (migration 2026-08-31_03). Only deals tagged with a
// campaign_id are broken out by campaign; untagged revenue comes back as one
// unattributed row instead of being guessed.
export async function getCampaignRoi(companyId: string, dateFrom: string, dateTo: string): Promise<CampaignRoi[]> {
  const { data, error } = await supabase.rpc("get_campaign_roi", {
    p_company_id: companyId,
    p_date_from: dateFrom,
    p_date_to: dateTo
  });
  if (error) throw error;
  return (data || []) as CampaignRoi[];
}
