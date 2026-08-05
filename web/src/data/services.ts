import { supabase } from "../lib/supabaseClient";

export async function listServices(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("company_services")
    .select("service")
    .eq("company_id", companyId)
    .order("position");
  if (error) throw error;
  return (data || []).map(row => row.service as string);
}
