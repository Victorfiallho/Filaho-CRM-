import { supabase } from "../lib/supabaseClient";
import { DEFAULT_CONTINGENCY_PCT, DEFAULT_DEPOSIT_PCT, DEFAULT_MINIMUM_MARGIN_PCT } from "../domain/costing";
import type { CompanyFinanceSettings } from "../domain/types";

// Created on first read with defaults, so new companies need no seed row.
export async function getFinanceSettings(companyId: string): Promise<CompanyFinanceSettings> {
  const { data, error } = await supabase.from("company_finance_settings").select("*").eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  if (data) return data as CompanyFinanceSettings;

  const defaults = {
    company_id: companyId,
    default_minimum_margin_pct: DEFAULT_MINIMUM_MARGIN_PCT,
    default_deposit_pct: DEFAULT_DEPOSIT_PCT,
    default_contingency_pct: DEFAULT_CONTINGENCY_PCT
  };
  const { data: inserted, error: insertError } = await supabase
    .from("company_finance_settings")
    .upsert(defaults, { onConflict: "company_id" })
    .select()
    .single();
  if (insertError) throw insertError;
  return inserted as CompanyFinanceSettings;
}
