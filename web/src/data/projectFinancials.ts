import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import { DEFAULT_DEPOSIT_PCT } from "../domain/costing";
import type { ProjectFinancials } from "../domain/types";

export async function getProjectFinancials(jobId: string): Promise<ProjectFinancials | null> {
  const { data, error } = await supabase.from("project_financials").select("*").eq("job_id", jobId).maybeSingle();
  if (error) throw error;
  return (data as ProjectFinancials) || null;
}

export async function listProjectFinancialsByCompany(companyId: string): Promise<ProjectFinancials[]> {
  const { data, error } = await supabase.from("project_financials").select("*").eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as ProjectFinancials[];
}

export async function createProjectFinancials(row: {
  company_id: string;
  job_id: string;
  original_contract_value?: number;
}): Promise<ProjectFinancials> {
  const record = {
    id: uid("pf"),
    deposit_pct: DEFAULT_DEPOSIT_PCT,
    deposit_schedule: [],
    original_contract_value: 0,
    discounts: 0,
    customer_fees: 0,
    payments_received_manual: 0,
    profit_release_stage: "",
    ...row,
    created_at: now()
  };
  const { data, error } = await supabase.from("project_financials").insert(record).select().single();
  if (error) throw error;
  return data as ProjectFinancials;
}

export async function updateProjectFinancials(id: string, companyId: string, patch: Partial<ProjectFinancials>): Promise<ProjectFinancials> {
  const sanitized = { ...patch, updated_at: now() };
  const { data, error } = await supabase
    .from("project_financials")
    .update(sanitized)
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as ProjectFinancials;
}
