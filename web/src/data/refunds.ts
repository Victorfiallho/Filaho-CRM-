import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import { toDateOrNull } from "../lib/numeric";
import type { Refund } from "../domain/types";

export async function listRefundsByJob(jobId: string): Promise<Refund[]> {
  const { data, error } = await supabase.from("refunds").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as Refund[];
}

export async function insertRefund(row: Omit<Refund, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<Refund> {
  const record = { id: row.id || uid("refund"), created_at: now(), ...row, expected_date: toDateOrNull(row.expected_date), received_date: toDateOrNull(row.received_date) };
  const { data, error } = await supabase.from("refunds").insert(record).select().single();
  if (error) throw error;
  return data as Refund;
}

// Never removes the original purchase/cost_line_item — this only ever
// updates the refund's own row (status/received_date/amount).
export async function updateRefund(id: string, companyId: string, patch: Partial<Refund>): Promise<Refund> {
  const sanitized = { ...patch, updated_at: now() } as Record<string, unknown>;
  if ("expected_date" in patch) sanitized.expected_date = toDateOrNull(patch.expected_date);
  if ("received_date" in patch) sanitized.received_date = toDateOrNull(patch.received_date);
  const { data, error } = await supabase.from("refunds").update(sanitized).eq("id", id).eq("company_id", companyId).select().single();
  if (error) throw error;
  return data as Refund;
}
