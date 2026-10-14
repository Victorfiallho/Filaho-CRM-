import { supabase } from "../lib/supabaseClient";
import type { FunnelStageSummary } from "../domain/types";

// get_funnel_summary() (migration 2026-08-31_02): per-stage conversion,
// velocity, value and forecast, never raw deal rows.
export async function getFunnelSummary(companyId: string, dateFrom?: string, dateTo?: string): Promise<FunnelStageSummary[]> {
  const { data, error } = await supabase.rpc("get_funnel_summary", {
    p_company_id: companyId,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null
  });
  if (error) throw error;
  return (data || []) as FunnelStageSummary[];
}
