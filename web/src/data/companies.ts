import { supabase } from "../lib/supabaseClient";
import type { Company } from "../domain/types";

// RLS limits `companies` to the ones the signed-in user is a member of.
export async function listMyCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from("companies").select("*").order("name");
  if (error) throw error;
  return (data || []) as Company[];
}

// The user's own company_members rows, with role. Gates owner-only nav
// items and routes.
export async function listMyMemberships(): Promise<{ company_id: string; role: string }[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return [];
  const { data, error } = await supabase.from("company_members").select("company_id, role").eq("user_id", userId);
  if (error) throw error;
  return data || [];
}
