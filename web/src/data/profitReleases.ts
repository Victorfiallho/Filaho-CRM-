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

// Append-only by design — releasing profit is a one-way historical event
// (amount, date, who approved it). There is no update/delete here; a wrong
// release is corrected by recording a new negative-amount entry with a note
// explaining why, same "never erase the original" principle as reversals.
export async function insertProfitRelease(row: { company_id: string; job_id: string; amount: number; notes?: string }): Promise<ProfitRelease> {
  const record = { id: uid("release"), released_at: now(), notes: "", created_at: now(), ...row };
  const { data, error } = await supabase.from("profit_releases").insert(record).select().single();
  if (error) throw error;
  return data as ProfitRelease;
}
