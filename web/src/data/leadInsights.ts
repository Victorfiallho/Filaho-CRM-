import { supabase } from "../lib/supabaseClient";
import type { StagnantLead } from "../domain/types";

// Backed by get_stagnant_leads() (supabase/migrations/2026-08-31_01_stagnant_leads.sql) —
// leads open in a non-won/lost stage longer than the company's stale_lead_days.
// SECURITY INVOKER RPC, so this already only ever returns the caller's own company's rows.
export async function getStagnantLeads(companyId: string): Promise<StagnantLead[]> {
  const { data, error } = await supabase.rpc("get_stagnant_leads", { p_company_id: companyId });
  if (error) throw error;
  return (data || []) as StagnantLead[];
}
