import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import { toDateOrNull, toNumericOrNull } from "../lib/numeric";
import type { Job } from "../domain/types";

export async function listJobs(companyId: string): Promise<Job[]> {
  const { data, error } = await supabase.from("jobs").select("*").eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as Job[];
}

export async function insertJob(row: Omit<Job, "id" | "created_at"> & { id?: string; created_at?: string }): Promise<Job> {
  const record = {
    id: row.id || uid("job"), created_at: row.created_at || now(), ...row,
    lat: toNumericOrNull(row.lat), lng: toNumericOrNull(row.lng),
    scheduled_date: toDateOrNull(row.scheduled_date)
  };
  const { data, error } = await supabase.from("jobs").insert(record).select().single();
  if (error) throw error;
  return data as Job;
}

export async function updateJob(id: string, companyId: string, patch: Partial<Job>): Promise<Job> {
  const sanitized = { ...patch, updated_at: now() } as Record<string, unknown>;
  if ("lat" in patch) sanitized.lat = toNumericOrNull(patch.lat);
  if ("lng" in patch) sanitized.lng = toNumericOrNull(patch.lng);
  if ("scheduled_date" in patch) sanitized.scheduled_date = toDateOrNull(patch.scheduled_date);
  const { data, error } = await supabase
    .from("jobs")
    .update(sanitized)
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as Job;
}

export async function deleteJob(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from("jobs").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}
