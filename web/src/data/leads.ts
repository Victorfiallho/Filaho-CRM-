import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
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
  const record = { id: row.id || uid("lead"), ...row };
  const { data, error } = await supabase.from("leads").insert(record).select().single();
  if (error) throw error;
  return data as Lead;
}

export async function updateLead(id: string, companyId: string, patch: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase
    .from("leads")
    .update({ ...patch, updated_at: now() })
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as Lead;
}
