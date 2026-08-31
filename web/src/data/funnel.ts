import { supabase } from "../lib/supabaseClient";
import type { FunnelStageSummary } from "../domain/types";

// Backed by get_funnel_summary() (supabase/migrations/2026-08-31_02_funnel_forecast.sql) —
// pre-aggregated per-stage conversion/velocity/value/forecast numbers only,
// never raw lead rows.
export async function getFunnelSummary(companyId: string, dateFrom?: string, dateTo?: string): Promise<FunnelStageSummary[]> {
  const { data, error } = await supabase.rpc("get_funnel_summary", {
    p_company_id: companyId,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null
  });
  if (error) throw error;
  return (data || []) as FunnelStageSummary[];
}
