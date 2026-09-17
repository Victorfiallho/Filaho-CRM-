import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import type { ChangeOrder } from "../domain/types";

export async function listChangeOrders(jobId: string): Promise<ChangeOrder[]> {
  const { data, error } = await supabase.from("change_orders").select("*").eq("job_id", jobId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as ChangeOrder[];
}

export async function listChangeOrdersByCompany(companyId: string): Promise<ChangeOrder[]> {
  const { data, error } = await supabase.from("change_orders").select("*").eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as ChangeOrder[];
}

export async function insertChangeOrder(row: Omit<ChangeOrder, "id" | "created_at" | "updated_at" | "approved_by" | "approved_at" | "status"> & { status?: ChangeOrder["status"] }): Promise<ChangeOrder> {
  const record = { id: uid("co"), status: "draft", approved_by: null, approved_at: null, created_at: now(), updated_at: now(), ...row };
  const { data, error } = await supabase.from("change_orders").insert(record).select().single();
  if (error) throw error;
  return data as ChangeOrder;
}

export async function setChangeOrderStatus(id: string, companyId: string, status: ChangeOrder["status"], approvedByUserId: string | null): Promise<ChangeOrder> {
  const patch: Partial<ChangeOrder> = { status, updated_at: now() };
  if (status === "approved") {
    patch.approved_by = approvedByUserId;
    patch.approved_at = now();
  }
  const { data, error } = await supabase.from("change_orders").update(patch).eq("id", id).eq("company_id", companyId).select().single();
  if (error) throw error;
  return data as ChangeOrder;
}

export async function deleteChangeOrder(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from("change_orders").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}
