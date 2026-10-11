import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import { toDateOrNull, toNumericOrNull, toTextOrNull } from "../lib/numeric";
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
  const record: Record<string, unknown> = { id: row.id || uid("lead"), ...row, lat: toNumericOrNull(row.lat), lng: toNumericOrNull(row.lng) };
  sanitizeOptionalLeadFields(record, row);
  const { data, error } = await supabase.from("leads").insert(record).select().single();
  if (error) throw error;
  return data as Lead;
}

export async function updateLead(id: string, companyId: string, patch: Partial<Lead>): Promise<Lead> {
  const sanitized = { ...patch, updated_at: now() } as Record<string, unknown>;
  if ("lat" in patch) sanitized.lat = toNumericOrNull(patch.lat);
  if ("lng" in patch) sanitized.lng = toNumericOrNull(patch.lng);
  sanitizeOptionalLeadFields(sanitized, patch);
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

// Only touches keys actually present, so a stage-only patch from the
// Pipeline board doesn't null out the owner or follow-up.
function sanitizeOptionalLeadFields(target: Record<string, unknown>, source: Partial<Lead>) {
  if ("owner_user_id" in source) target.owner_user_id = toTextOrNull(source.owner_user_id);
  if ("next_action" in source) target.next_action = toTextOrNull(source.next_action);
  if ("next_action_date" in source) target.next_action_date = toDateOrNull(source.next_action_date);
  if ("lost_reason" in source) target.lost_reason = toTextOrNull(source.lost_reason);
}

export async function deleteLead(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from("leads").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}
