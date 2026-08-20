import { now, uid } from "../domain/format";
import type { RecordNote } from "../domain/types";
import { supabase } from "../lib/supabaseClient";

export async function listNotes(companyId: string, entityType: string, entityId: string): Promise<RecordNote[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("company_id", companyId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as RecordNote[];
}

export async function insertNote(row: {
  company_id: string;
  entity_type: string;
  entity_id: string;
  body: string;
  user_id: string | null;
}): Promise<RecordNote> {
  const record = { id: uid("note"), created_at: now(), ...row };
  const { data, error } = await supabase.from("notes").insert(record).select().single();
  if (error) throw error;
  return data as RecordNote;
}

export async function deleteNote(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from("notes").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}
