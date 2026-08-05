import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import { toNumericOrNull } from "../lib/numeric";
import type { Customer } from "../domain/types";

export async function listCustomers(companyId: string): Promise<Customer[]> {
  const { data, error } = await supabase.from("customers").select("*").eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as Customer[];
}

export async function getCustomer(id: string, companyId: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return (data as Customer) || null;
}

export async function insertCustomer(row: Omit<Customer, "id" | "created_at"> & { id?: string; created_at?: string }): Promise<Customer> {
  const record = { id: row.id || uid("cust"), created_at: row.created_at || now(), ...row, lat: toNumericOrNull(row.lat), lng: toNumericOrNull(row.lng) };
  const { data, error } = await supabase.from("customers").insert(record).select().single();
  if (error) throw error;
  return data as Customer;
}

export async function updateCustomer(id: string, companyId: string, patch: Partial<Customer>): Promise<Customer> {
  const sanitized = { ...patch, updated_at: now() } as Record<string, unknown>;
  if ("lat" in patch) sanitized.lat = toNumericOrNull(patch.lat);
  if ("lng" in patch) sanitized.lng = toNumericOrNull(patch.lng);
  const { data, error } = await supabase
    .from("customers")
    .update(sanitized)
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as Customer;
}
