import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import { toNumericOrNull } from "../lib/numeric";
import type { Lead } from "../domain/types";

export async function listLeads(companyId: string): Promise<Lead[]> {
  const { data, error } = await supabase.from("leads").select("*").eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as Lead[];
}

export async function getLead(id: string, companyId: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return (data as Lead) || null;
}

export async function insertLead(row: Omit<Lead, "id"> & { id?: string }): Promise<Lead> {
  const record = { id: row.id || uid("lead"), ...row, lat: toNumericOrNull(row.lat), lng: toNumericOrNull(row.lng) };
  const { data, error } = await supabase.from("leads").insert(record).select().single();
  if (error) throw error;
  return data as Lead;
}

export async function updateLead(id: string, companyId: string, patch: Partial<Lead>): Promise<Lead> {
  const sanitized = { ...patch, updated_at: now() } as Record<string, unknown>;
  if ("lat" in patch) sanitized.lat = toNumericOrNull(patch.lat);
  if ("lng" in patch) sanitized.lng = toNumericOrNull(patch.lng);
  const { data, error } = await supabase
    .from("leads")
    .update(sanitized)
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as Lead;
}

export async function deleteLead(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from("leads").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}
