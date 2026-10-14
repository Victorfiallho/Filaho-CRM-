import { planServiceChanges, renamePasses, type ServiceDraft } from "../domain/services";
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

// Records that store a service by name.
const SERVICE_TABLES = ["leads", "jobs", "customers"] as const;

async function renameEverywhere(companyId: string, from: string, to: string) {
  const { error } = await supabase.from("company_services").update({ service: to }).eq("company_id", companyId).eq("service", from);
  if (error) throw error;
  for (const table of SERVICE_TABLES) {
    const { error: e } = await supabase.from(table).update({ service_type: to }).eq("company_id", companyId).eq("service_type", from);
    if (e) throw e;
  }
}

// Applies an edited list: deletes, renames (carried to leads/jobs/clients
// that use the old name), new rows, and the order. Removing a service
// leaves records that used it unchanged.
export async function saveServices(companyId: string, saved: string[], draft: ServiceDraft[]): Promise<void> {
  const plan = planServiceChanges(saved, draft);
  if (plan.deletes.length) {
    const { error } = await supabase.from("company_services").delete().eq("company_id", companyId).in("service", plan.deletes);
    if (error) throw error;
  }
  for (const pass of renamePasses(plan.renames)) {
    for (const [from, to] of pass) await renameEverywhere(companyId, from, to);
  }
  const { error } = await supabase
    .from("company_services")
    .upsert(plan.final.map((service, position) => ({ company_id: companyId, service, position })), { onConflict: "company_id,service" });
  if (error) throw error;
}
