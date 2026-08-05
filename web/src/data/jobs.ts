import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import type { Job } from "../domain/types";

export async function listJobs(companyId: string): Promise<Job[]> {
  const { data, error } = await supabase.from("jobs").select("*").eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as Job[];
}

export async function insertJob(row: Omit<Job, "id" | "created_at"> & { id?: string }): Promise<Job> {
  const record = { id: row.id || uid("job"), created_at: now(), ...row };
  const { data, error } = await supabase.from("jobs").insert(record).select().single();
  if (error) throw error;
  return data as Job;
}

export async function updateJob(id: string, companyId: string, patch: Partial<Job>): Promise<Job> {
  const { data, error } = await supabase
    .from("jobs")
    .update({ ...patch, updated_at: now() })
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as Job;
}
