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

// Own company_members rows, role included — the users/UserManagement page
// uses this to decide whether to show its nav link and to gate the route,
// same "only see your own row" RLS as listMyCompanies (company_members_select).
export async function listMyMemberships(): Promise<{ company_id: string; role: string }[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return [];
  const { data, error } = await supabase.from("company_members").select("company_id, role").eq("user_id", userId);
  if (error) throw error;
  return data || [];
}
