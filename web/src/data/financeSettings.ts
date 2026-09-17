import { supabase } from "../lib/supabaseClient";
import { now } from "../domain/format";
import { DEFAULT_CONTINGENCY_PCT, DEFAULT_DEPOSIT_PCT, DEFAULT_MINIMUM_MARGIN_PCT } from "../domain/costing";
import type { CompanyFinanceSettings } from "../domain/types";

// Row is created lazily on first read (upsert-on-miss) rather than requiring
// a migration-time seed per company — new companies added later get sane
// defaults automatically the first time anyone opens the costing module.
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

export async function updateFinanceSettings(companyId: string, patch: Partial<CompanyFinanceSettings>): Promise<CompanyFinanceSettings> {
  const sanitized = { ...patch, updated_at: now() };
  const { data, error } = await supabase
    .from("company_finance_settings")
    .update(sanitized)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as CompanyFinanceSettings;
}
