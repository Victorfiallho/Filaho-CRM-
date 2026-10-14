import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import type { ProfitRelease } from "../domain/types";

export async function listProfitReleases(jobId: string): Promise<ProfitRelease[]> {
  const { data, error } = await supabase.from("profit_releases").select("*").eq("job_id", jobId).order("released_at", { ascending: false });
  if (error) throw error;
  return (data || []) as ProfitRelease[];
}

export async function listProfitReleasesByCompany(companyId: string): Promise<ProfitRelease[]> {
  const { data, error } = await supabase.from("profit_releases").select("*").eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as ProfitRelease[];
}

// Append-only: a release is a historical event. A wrong one is corrected by
// recording a negative entry with a note, never by editing.
export async function insertProfitRelease(row: { company_id: string; job_id: string; amount: number; notes?: string }): Promise<ProfitRelease> {
  const record = { id: uid("release"), released_at: now(), notes: "", created_at: now(), ...row };
  const { data, error } = await supabase.from("profit_releases").insert(record).select().single();
  if (error) throw error;
  return data as ProfitRelease;
}
