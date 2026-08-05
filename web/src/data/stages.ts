import { supabase } from "../lib/supabaseClient";
import type { PipelineStage } from "../domain/types";

export async function listStages(companyId: string): Promise<PipelineStage[]> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("company_id", companyId)
    .order("order");
  if (error) throw error;
  return (data || []) as PipelineStage[];
}
