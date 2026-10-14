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

export async function insertStage(stage: PipelineStage): Promise<PipelineStage> {
  const { data, error } = await supabase.from("pipeline_stages").insert(stage).select().single();
  if (error) throw error;
  return data as PipelineStage;
}

export async function updateStage(companyId: string, id: string, patch: Partial<PipelineStage>): Promise<PipelineStage> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .update(patch)
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as PipelineStage;
}

export async function deleteStage(companyId: string, id: string): Promise<void> {
  const { error } = await supabase.from("pipeline_stages").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}

// A stage can't be deleted while deals sit in it; they'd vanish from the board.
export async function countLeadsInStage(companyId: string, stageId: string): Promise<number> {
  const { count, error } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("stage_id", stageId);
  if (error) throw error;
  return count || 0;
}
