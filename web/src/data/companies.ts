import { supabase } from "../lib/supabaseClient";
import type { Company } from "../domain/types";

// RLS on `companies` already restricts rows to ones the signed-in user has a
// company_members row for, so this is the same set app.js used to build from
// the signed-in user's `company_ids` — just sourced from the DB now.
export async function listMyCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from("companies").select("*").order("name");
  if (error) throw error;
  return (data || []) as Company[];
}
