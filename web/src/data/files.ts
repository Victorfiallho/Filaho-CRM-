import { now, uid } from "../domain/format";
import type { RecordFile } from "../domain/types";
import { supabase } from "../lib/supabaseClient";

export async function listFiles(companyId: string, entityType: string, entityId: string): Promise<RecordFile[]> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("company_id", companyId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as RecordFile[];
}

export async function insertFile(row: {
  company_id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  url: string;
  provider?: string;
}): Promise<RecordFile> {
  const record = { id: uid("file"), created_at: now(), provider: "google_drive", ...row };
  const { data, error } = await supabase.from("files").insert(record).select().single();
  if (error) throw error;
  return data as RecordFile;
}

export async function deleteFile(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from("files").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}
