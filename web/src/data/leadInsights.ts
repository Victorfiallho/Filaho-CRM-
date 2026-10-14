import { supabase } from "../lib/supabaseClient";
import type { StagnantLead } from "../domain/types";

// get_stagnant_leads() (migration 2026-08-31_01): open deals sitting in a
// stage longer than the company's stale_lead_days. SECURITY INVOKER, so only
// the caller's companies come back.
export async function getStagnantLeads(companyId: string): Promise<StagnantLead[]> {
  const { data, error } = await supabase.rpc("get_stagnant_leads", { p_company_id: companyId });
  if (error) throw error;
  return (data || []) as StagnantLead[];
}
