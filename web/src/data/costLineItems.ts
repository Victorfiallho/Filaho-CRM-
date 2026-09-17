import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import { toDateOrNull, toNumericOrNull } from "../lib/numeric";
import type { CostLineItem } from "../domain/types";

export async function listCostLineItems(jobId: string): Promise<CostLineItem[]> {
  const { data, error } = await supabase.from("cost_line_items").select("*").eq("job_id", jobId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as CostLineItem[];
}

export async function listCostLineItemsByCompany(companyId: string): Promise<CostLineItem[]> {
  const { data, error } = await supabase.from("cost_line_items").select("*").eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as CostLineItem[];
}

// created_by is intentionally not required here — the column defaults to
// auth.uid() at the database level (see the Phase 1 migration's comment).
export async function insertCostLineItem(row: Omit<CostLineItem, "id" | "net_cost" | "created_at" | "updated_at" | "created_by"> & { id?: string }): Promise<CostLineItem> {
  const record = {
    id: row.id || uid("cli"),
    created_at: now(),
    ...row,
    expected_date: toDateOrNull(row.expected_date),
    purchase_date: toDateOrNull(row.purchase_date)
  };
  const { data, error } = await supabase.from("cost_line_items").insert(record).select().single();
  if (error) throw error;
  return data as CostLineItem;
}

export async function updateCostLineItem(id: string, companyId: string, patch: Partial<CostLineItem>): Promise<CostLineItem> {
  const sanitized = { ...patch, updated_at: now() } as Record<string, unknown>;
  if ("expected_date" in patch) sanitized.expected_date = toDateOrNull(patch.expected_date);
  if ("purchase_date" in patch) sanitized.purchase_date = toDateOrNull(patch.purchase_date);
  for (const numericField of ["estimated_cost", "quoted_to_customer", "committed_amount", "actual_paid", "internal_cost", "tax", "freight", "discount", "returned_amount"] as const) {
    if (numericField in patch) sanitized[numericField] = toNumericOrNull(patch[numericField]) ?? 0;
  }
  const { data, error } = await supabase.from("cost_line_items").update(sanitized).eq("id", id).eq("company_id", companyId).select().single();
  if (error) throw error;
  return data as CostLineItem;
}

export async function deleteCostLineItem(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from("cost_line_items").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}
